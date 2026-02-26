/**
 * Proactive Scheduler (The Observer)
 *
 * Runs as a background cron job that:
 * 1. Polls data from proactive-enabled MCP tools
 * 2. Fetches relevant user knowledge for context
 * 3. Calls the LLM to assess if any information requires action
 * 4. Creates approval requests or notifications as needed
 */

import { CronJob } from "cron";
import { getMcpManager } from "@/lib/mcp";
import { createChatProvider } from "@/lib/llm";
import { runAgentLoop } from "@/lib/agent";
import {
  isBuiltinWebTool,
  executeBuiltinWebTool,
  BUILTIN_WEB_TOOLS,
  isBrowserTool,
  executeBrowserTool,
  BUILTIN_BROWSER_TOOLS,
  isFsTool,
  executeBuiltinFsTool,
  BUILTIN_FS_TOOLS,
  isNetworkTool,
  executeBuiltinNetworkTool,
  BUILTIN_NETWORK_TOOLS,
  isEmailTool,
  executeBuiltinEmailTool,
  BUILTIN_EMAIL_TOOLS,
  isCustomTool,
  executeCustomTool,
  getCustomToolDefinitions,
  BUILTIN_TOOLMAKER_TOOLS,
} from "@/lib/agent";
import {
  listToolPolicies,
  getToolPolicy,
  addLog,
  createApprovalRequest,
  createThread,
  addMessage,
  listChannels,
  getUserByEmail,
  isUserEnabled,
  getDb,
} from "@/lib/db";
import { ingestKnowledgeFromText } from "@/lib/knowledge";
import { retrieveKnowledge } from "@/lib/knowledge/retriever";
import { simpleParser } from "mailparser";
import { notifyAdmin } from "@/lib/channels/notify";
import {
  createImapClient,
  formatEmailConnectError,
  getEmailChannelConfig,
  getImapSecureCandidates,
  sendSmtpMail,
} from "@/lib/channels/email-transport";
import type { ToolDefinition } from "@/lib/llm";

const PROACTIVE_SYSTEM_PROMPT = `You are the Nexus proactive observer. You have been given data polled from external services.

Your job:
1. Analyze the data for anything noteworthy, urgent, or requiring the owner's attention.
2. If a concrete action can be taken now, you MUST respond with a JSON object: { "action_needed": true, "tool": "tool_name", "args": {}, "reasoning": "why" }
3. Do NOT return "action needed" as narrative text without tool+args. Prefer executable actions over summaries.
4. Only respond with { "action_needed": false, "summary": "brief note" } when there is truly no concrete action to execute.
4. Consider the user's known preferences and context.

Always respond with valid JSON only.`;

let _cronJob: CronJob | null = null;
const _proactiveSkipWarned = new Set<string>();
const _emailConfigWarned = new Set<string>();
const _proactivePollArgWarned = new Set<string>();

const MAX_POLLED_DATA_CHARS = 6000;
const MAX_KNOWLEDGE_CONTEXT_CHARS = 2000;

interface ProactiveAssessment {
  action_needed?: boolean;
  tool?: string;
  args?: Record<string, unknown>;
  reasoning?: string;
  summary?: string;
}

interface ProactiveWebContext {
  query: string;
  results: Array<{ url: string; title: string; snippet?: string }>;
  nextResultIndex: number;
}

interface ProactiveWebState {
  context: ProactiveWebContext | null;
  initAttempted: boolean;
}

function getToolServerId(qualifiedToolName: string): string | null {
  const dotIndex = qualifiedToolName.indexOf(".");
  if (dotIndex === -1) return null;
  return qualifiedToolName.substring(0, dotIndex);
}

type SchedulerToolExecution =
  | { skipped: true }
  | { skipped: false; result: unknown };

function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  return (match?.[1] || trimmed).trim();
}

function resolveChannelThread(channelId: string, senderId: string, userId: string | null): string {
  const db = getDb();
  const tag = `channel:${channelId}:${senderId}`;

  const existing = db
    .prepare("SELECT id FROM threads WHERE title = ? AND status = 'active' ORDER BY last_message_at DESC LIMIT 1")
    .get(tag) as { id: string } | undefined;

  if (existing) return existing.id;

  const thread = createThread(tag, userId ?? undefined);
  return thread.id;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function parseAssessmentJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]) as Record<string, unknown>;
      } catch {
        // continue to object extraction
      }
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toProactiveAssessment(value: Record<string, unknown>): ProactiveAssessment {
  const args =
    value.args && typeof value.args === "object" && !Array.isArray(value.args)
      ? (value.args as Record<string, unknown>)
      : undefined;

  return {
    action_needed: value.action_needed === true,
    tool: typeof value.tool === "string" ? value.tool : undefined,
    args,
    reasoning: typeof value.reasoning === "string" ? value.reasoning : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
  };
}

async function buildProactiveWebQuery(): Promise<string> {
  const facts = await retrieveKnowledge("owner priorities projects interests watchlist alerts", 8);
  const tokens = facts
    .map((f) => `${f.entity} ${f.attribute} ${f.value}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!tokens) {
    return "important updates and alerts relevant to user projects and priorities";
  }
  return truncateText(`important updates and alerts for: ${tokens}`, 240);
}

function toWebResultList(result: unknown): Array<{ url: string; title: string; snippet?: string }> {
  if (!result || typeof result !== "object") return [];
  const raw = (result as { results?: unknown }).results;
  if (!Array.isArray(raw)) return [];
  const cleaned: Array<{ url: string; title: string; snippet?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.url !== "string" || !rec.url.startsWith("http")) continue;
    cleaned.push({
      url: rec.url,
      title: typeof rec.title === "string" ? rec.title : rec.url,
      snippet: typeof rec.snippet === "string" ? rec.snippet : undefined,
    });
  }
  return cleaned;
}

async function ensureProactiveWebContext(
  state: ProactiveWebState,
  mcpManager: ReturnType<typeof getMcpManager>
): Promise<void> {
  if (state.context || state.initAttempted) return;
  state.initAttempted = true;

  const query = await buildProactiveWebQuery();
  const search = await executeSchedulerTool("builtin.web_search", { query, maxResults: 6 }, mcpManager);
  if (search.skipped) return;

  const results = toWebResultList(search.result);
  if (results.length === 0) return;

  state.context = {
    query,
    results,
    nextResultIndex: 0,
  };
}

async function getProactivePollArgs(
  toolName: string,
  mcpManager: ReturnType<typeof getMcpManager>,
  webState: ProactiveWebState
): Promise<Record<string, unknown> | null> {
  if (!toolRequiresArguments(toolName, mcpManager)) return {};

  if (toolName === "builtin.web_search") {
    const query = await buildProactiveWebQuery();
    return { query, maxResults: 6 };
  }

  if (toolName === "builtin.web_fetch" || toolName === "builtin.web_extract") {
    await ensureProactiveWebContext(webState, mcpManager);
    const context = webState.context;
    if (!context || context.results.length === 0) return null;

    const result = context.results[context.nextResultIndex % context.results.length];
    context.nextResultIndex += 1;

    if (toolName === "builtin.web_fetch") {
      return { url: result.url };
    }

    return {
      url: result.url,
      query: context.query,
    };
  }

  return null;
}

function toolRequiresArguments(toolName: string, mcpManager: ReturnType<typeof getMcpManager>): boolean {
  const builtinDefs: ToolDefinition[] = [
    ...BUILTIN_WEB_TOOLS,
    ...BUILTIN_BROWSER_TOOLS,
    ...BUILTIN_FS_TOOLS,
    ...BUILTIN_NETWORK_TOOLS,
    ...BUILTIN_EMAIL_TOOLS,
    ...BUILTIN_TOOLMAKER_TOOLS,
    ...getCustomToolDefinitions(),
  ];

  const allDefs = [...builtinDefs, ...mcpManager.getAllTools()];
  const def = allDefs.find((tool) => tool.name === toolName);
  const schema = (def?.inputSchema || {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required.length > 0;
}

async function pollEmailChannels(): Promise<void> {
  const emailChannels = listChannels().filter((c) => c.channel_type === "email" && !!c.enabled);
  if (emailChannels.length === 0) return;

  for (const channel of emailChannels) {
    let rawConfig: Record<string, unknown>;
    try {
      rawConfig = JSON.parse(channel.config_json || "{}");
    } catch {
      rawConfig = {};
    }

    const config = getEmailChannelConfig(rawConfig);

    if (!config.imapHost || !config.imapPort || !config.imapUser || !config.imapPass) {
      if (!_emailConfigWarned.has(channel.id)) {
        addLog({
          level: "warn",
          source: "email",
          message: `Email channel \"${channel.label}\" is missing IMAP configuration (imapHost/imapPort/imapUser/imapPass).`,
          metadata: JSON.stringify({ channelId: channel.id }),
        });
        _emailConfigWarned.add(channel.id);
      }
      continue;
    }
    _emailConfigWarned.delete(channel.id);

    let connected = false;
    let lastConnectErr: unknown = null;

    for (const secure of getImapSecureCandidates(config.imapPort)) {
      const client = createImapClient(config, secure);
      try {
        await client.connect();
        connected = true;

        const lock = await client.getMailboxLock("INBOX");
        try {
          const unseenRaw = await client.search({ seen: false });
          const unseen = Array.isArray(unseenRaw) ? unseenRaw : [];
          if (unseen.length === 0) continue;

          for await (const msg of client.fetch(unseen, { uid: true, envelope: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source as Buffer);
              const fromAddress = parsed.from?.value?.[0]?.address
                ? normalizeEmail(parsed.from.value[0].address)
                : "";
              const subject = (parsed.subject || "New Email").trim();
              const textBody = (parsed.text || parsed.html || "").toString().trim();

              if (!fromAddress) {
                await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
                continue;
              }

              const mappedUser = getUserByEmail(fromAddress);
              const isKnownUser = !!mappedUser && isUserEnabled(mappedUser.id);

              if (!isKnownUser) {
                const notifyThreadId = resolveChannelThread(channel.id, fromAddress, channel.user_id ?? null);
                addMessage({
                  thread_id: notifyThreadId,
                  role: "system",
                  content:
                    `[Email Notification] Message received from unregistered sender: ${fromAddress}` +
                    `\nSubject: ${subject}` +
                    `\nBody:\n${textBody || "(empty)"}`,
                  tool_calls: null,
                  tool_results: null,
                  attachments: null,
                });
                try {
                  await notifyAdmin(
                    `Inbound email from unregistered sender.\nFrom: ${fromAddress}\nSubject: ${subject}\nThread: ${notifyThreadId}`,
                    "Nexus Email Notification"
                  );
                } catch {
                  // non-blocking notification path
                }
                await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
                continue;
              }

              const threadId = resolveChannelThread(channel.id, fromAddress, mappedUser!.id);
              const taggedText = `[External Channel Message from email user "${fromAddress}"]\nSubject: ${subject}\n\n${textBody || "(empty)"}`;
              const result = await runAgentLoop(
                threadId,
                taggedText,
                undefined,
                undefined,
                undefined,
                mappedUser!.id
              );

              try {
                await sendSmtpMail(config, {
                  from: config.fromAddress,
                  to: fromAddress,
                  subject: `Re: ${subject}`,
                  text: (result.content || "").trim() || "No response content.",
                });
              } catch (smtpErr) {
                const smtpMsg = formatEmailConnectError(smtpErr);
                addLog({
                  level: "error",
                  source: "email",
                  message: `Failed sending SMTP reply for channel "${channel.label}": ${smtpMsg}`,
                  metadata: JSON.stringify({ channelId: channel.id, from: fromAddress }),
                });
                try {
                  await notifyAdmin(
                    `Failed SMTP reply on email channel ${channel.label}.\nTo: ${fromAddress}\nError: ${smtpMsg}`,
                    "Nexus Email Delivery Failure"
                  );
                } catch {
                  // non-blocking notification path
                }
              }

              await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
            } catch (messageErr) {
              addLog({
                level: "error",
                source: "email",
                message: `Failed processing inbound email on channel "${channel.label}": ${messageErr}`,
                metadata: JSON.stringify({ channelId: channel.id }),
              });
              try {
                await notifyAdmin(
                  `Failed processing inbound email on channel ${channel.label}.\nError: ${messageErr}`,
                  "Nexus Email Processing Failure"
                );
              } catch {
                // non-blocking notification path
              }
            }
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        lastConnectErr = err;
      } finally {
        try {
          await client.logout();
        } catch {
          // ignore
        }
      }

      if (connected) break;
    }

    if (!connected) {
      const errMsg = formatEmailConnectError(lastConnectErr);
      addLog({
        level: "error",
        source: "email",
        message: `IMAP poll failed for email channel "${channel.label}": ${errMsg}`,
        metadata: JSON.stringify({ channelId: channel.id }),
      });
      try {
        await notifyAdmin(
          `IMAP poll failed for email channel ${channel.label}.\nError: ${errMsg}`,
          "Nexus Email Poll Failure"
        );
      } catch {
        // non-blocking notification path
      }
    }
  }
}

async function executeSchedulerTool(
  toolName: string,
  args: Record<string, unknown>,
  mcpManager: ReturnType<typeof getMcpManager>
): Promise<SchedulerToolExecution> {
  if (isBuiltinWebTool(toolName)) {
    return { skipped: false, result: await executeBuiltinWebTool(toolName, args) };
  }
  if (isBrowserTool(toolName)) {
    return { skipped: false, result: await executeBrowserTool(toolName, args) };
  }
  if (isFsTool(toolName)) {
    return { skipped: false, result: await executeBuiltinFsTool(toolName, args) };
  }
  if (isNetworkTool(toolName)) {
    return { skipped: false, result: await executeBuiltinNetworkTool(toolName, args) };
  }
  if (isEmailTool(toolName)) {
    return { skipped: false, result: await executeBuiltinEmailTool(toolName, args) };
  }
  if (isCustomTool(toolName)) {
    return { skipped: false, result: await executeCustomTool(toolName, args) };
  }

  const serverId = getToolServerId(toolName);
  if (!serverId || !mcpManager.isConnected(serverId)) {
    if (!_proactiveSkipWarned.has(toolName)) {
      addLog({
        level: "warn",
        source: "scheduler",
        message: `Skipping proactive tool \"${toolName}\": MCP server \"${serverId || "unknown"}\" is not connected.`,
        metadata: null,
      });
      _proactiveSkipWarned.add(toolName);
    }
    return { skipped: true };
  }

  // Connected now: allow future disconnected warning if it drops again
  _proactiveSkipWarned.delete(toolName);
  return { skipped: false, result: await mcpManager.callTool(toolName, args) };
}

/**
 * Run a single proactive scan cycle.
 */
export async function runProactiveScan(): Promise<void> {
  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan started.",
    metadata: null,
  });

  try {
    await pollEmailChannels();
  } catch (err) {
    addLog({
      level: "error",
      source: "email",
      message: `Email polling cycle failed: ${err}`,
      metadata: null,
    });
  }

  const mcpManager = getMcpManager();
  const policies = listToolPolicies().filter((p) => p.is_proactive_enabled);
  const proactiveWebState: ProactiveWebState = {
    context: null,
    initAttempted: false,
  };

  if (policies.length === 0) {
    addLog({
      level: "info",
      source: "scheduler",
      message: "No proactive-enabled tools configured. Skipping scan.",
      metadata: null,
    });
    return;
  }

  for (const policy of policies) {
    try {
      const pollArgs = await getProactivePollArgs(policy.tool_name, mcpManager, proactiveWebState);
      if (pollArgs === null) {
        if (!_proactivePollArgWarned.has(policy.tool_name)) {
          addLog({
            level: "warn",
            source: "scheduler",
            message: `Skipping proactive poll for "${policy.tool_name}": required input arguments are unavailable in current proactive context.`,
            metadata: null,
          });
          _proactivePollArgWarned.add(policy.tool_name);
        }
        continue;
      }
      _proactivePollArgWarned.delete(policy.tool_name);

      // Poll the tool for data (assuming list/read-type tools)
      const poll = await executeSchedulerTool(policy.tool_name, pollArgs, mcpManager);
      if (poll.skipped) continue;
      const result = poll.result;
      if (policy.tool_name === "builtin.web_search") {
        const query = typeof pollArgs.query === "string" ? pollArgs.query : "web updates";
        const results = toWebResultList(result);
        if (results.length > 0) {
          proactiveWebState.context = {
            query,
            results,
            nextResultIndex: 0,
          };
        }
      }
      const polledDataRaw = JSON.stringify(result);
      const polledData = truncateText(polledDataRaw, MAX_POLLED_DATA_CHARS);

      await ingestKnowledgeFromText({
        source: `mcp:${policy.tool_name}:poll`,
        text: `[Polled Data from ${policy.tool_name}]\n${polledData}`,
        contextHint: "Extract durable facts about the owner discovered via proactive scanning.",
      });

      addLog({
        level: "info",
        source: "scheduler",
        message: `Polled data from "${policy.tool_name}".`,
        metadata: JSON.stringify({ dataPreview: polledData.substring(0, 200) }),
      });

      // Ask the LLM to assess
      const provider = createChatProvider();
      const knowledgeFacts = await retrieveKnowledge(polledData, 6);
      const knowledgeContextRaw = knowledgeFacts
        .map((k) => `- ${k.entity} / ${k.attribute}: ${k.value}`)
        .join("\n");
      const knowledgeContext = truncateText(knowledgeContextRaw, MAX_KNOWLEDGE_CONTEXT_CHARS);

      const response = await provider.chat(
        [
          {
            role: "user",
            content: `[Polled Data from ${policy.tool_name}]\n${polledData}\n\n[User Knowledge Context]\n${knowledgeContext || "(none)"}`,
          },
        ],
        undefined,
        PROACTIVE_SYSTEM_PROMPT
      );

      if (!response.content) continue;

      const assessmentRaw = parseAssessmentJson(response.content);
      if (!assessmentRaw) {
        addLog({
          level: "warn",
          source: "scheduler",
          message: `Failed to parse LLM assessment for "${policy.tool_name}".`,
          metadata: JSON.stringify({ rawResponse: truncateText(response.content, 1000) }),
        });
        continue;
      }

      const assessment = toProactiveAssessment(assessmentRaw);

      try {

        await ingestKnowledgeFromText({
          source: `mcp:${policy.tool_name}:assessment`,
          text: response.content,
        });

        if (assessment.action_needed) {
          const actionTool = assessment.tool && assessment.tool.trim() ? assessment.tool : policy.tool_name;
          const actionPolicy =
            actionTool === policy.tool_name ? policy : getToolPolicy(actionTool);
          const requiresApproval = actionPolicy
            ? actionPolicy.requires_approval !== 0
            : true;
          const actionArgs = assessment.args || {};
          const reasoning = assessment.reasoning || "Proactive observer requested an action.";

          addLog({
            level: "info",
            source: "scheduler",
            message: `Proactive action triggered: ${reasoning}`,
            metadata: JSON.stringify(assessment),
          });

          // Create a proactive thread
          const thread = createThread(`[Proactive] ${policy.tool_name}`);

          addMessage({
            thread_id: thread.id,
            role: "system",
            content: `Proactive scan detected an action from "${policy.tool_name}": ${reasoning}`,
            tool_calls: null,
            tool_results: null,
            attachments: null,
          });

          if (requiresApproval) {
            const approval = createApprovalRequest({
              thread_id: thread.id,
              tool_name: actionTool,
              args: JSON.stringify(actionArgs),
              reasoning,
            });

            try {
              await notifyAdmin(
                `Proactive approval required for tool ${actionTool}.\nThread: ${thread.id}\nApproval: ${approval.id}\nReason: ${reasoning}`,
                "Nexus Proactive Approval Required"
              );
            } catch {
              // non-blocking notification path
            }
          } else {
            try {
              const execution = await executeSchedulerTool(actionTool, actionArgs, mcpManager);
              if (execution.skipped) {
                continue;
              }
              const executionResult = execution.result;

              addLog({
                level: "info",
                source: "scheduler",
                message: `Proactive tool "${actionTool}" executed automatically.`,
                metadata: JSON.stringify({
                  resultPreview: JSON.stringify(executionResult).substring(0, 200),
                }),
              });

              addMessage({
                thread_id: thread.id,
                role: "tool",
                content: JSON.stringify(executionResult),
                tool_calls: null,
                tool_results: JSON.stringify({ name: actionTool, result: executionResult }),
                attachments: null,
              });

              addMessage({
                thread_id: thread.id,
                role: "assistant",
                content: `✅ Proactive action "${actionTool}" completed: ${reasoning}`,
                tool_calls: null,
                tool_results: null,
                attachments: null,
              });
            } catch (executionError) {
              addLog({
                level: "error",
                source: "scheduler",
                message: `Auto-executed tool "${actionTool}" failed: ${executionError}`,
                metadata: null,
              });

              try {
                await notifyAdmin(
                  `Auto-executed proactive action failed.\nTool: ${actionTool}\nThread: ${thread.id}\nError: ${executionError}`,
                  "Nexus Proactive Action Failure"
                );
              } catch {
                // non-blocking notification path
              }

              addMessage({
                thread_id: thread.id,
                role: "system",
                content: `⚠️ Failed to execute proactive action "${actionTool}": ${executionError}`,
                tool_calls: null,
                tool_results: null,
                attachments: null,
              });
            }
          }
        } else {
          addLog({
            level: "info",
            source: "scheduler",
            message: `No action needed for "${policy.tool_name}": ${assessment.summary || "(no summary provided)"}`,
            metadata: null,
          });
        }
      } catch {
        addLog({
          level: "warn",
          source: "scheduler",
          message: `Failed to parse LLM assessment for "${policy.tool_name}".`,
          metadata: JSON.stringify({ rawResponse: truncateText(response.content, 1000) }),
        });
      }
    } catch (err) {
      addLog({
        level: "error",
        source: "scheduler",
        message: `Error polling "${policy.tool_name}": ${err}`,
        metadata: null,
      });
    }
  }

  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan completed.",
    metadata: null,
  });
}

/**
 * Start the proactive scheduler cron job.
 */
export function startScheduler(): void {
  if (_cronJob) {
    _cronJob.stop();
  }

  const schedule = process.env.PROACTIVE_CRON_SCHEDULE || "*/15 * * * *";

  _cronJob = new CronJob(schedule, async () => {
    try {
      await runProactiveScan();
    } catch (err) {
      addLog({
        level: "error",
        source: "scheduler",
        message: `Scheduler error: ${err}`,
        metadata: null,
      });
    }
  });

  _cronJob.start();

  addLog({
    level: "info",
    source: "scheduler",
    message: `Proactive scheduler started with schedule: ${schedule}`,
    metadata: null,
  });
}

/**
 * Stop the proactive scheduler.
 */
export function stopScheduler(): void {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scheduler stopped.",
      metadata: null,
    });
  }
}
