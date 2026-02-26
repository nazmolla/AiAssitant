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
  isBrowserTool,
  executeBrowserTool,
  isFsTool,
  executeBuiltinFsTool,
  isNetworkTool,
  executeBuiltinNetworkTool,
  isCustomTool,
  executeCustomTool,
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
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const PROACTIVE_SYSTEM_PROMPT = `You are the Nexus proactive observer. You have been given data polled from external services.

Your job:
1. Analyze the data for anything noteworthy, urgent, or requiring the owner's attention.
2. If an action is needed, respond with a JSON object: { "action_needed": true, "tool": "tool_name", "args": {}, "reasoning": "why" }
3. If no action is needed, respond with: { "action_needed": false, "summary": "brief note" }
4. Consider the user's known preferences and context.

Always respond with valid JSON only.`;

let _cronJob: CronJob | null = null;
const _proactiveSkipWarned = new Set<string>();
const _emailConfigWarned = new Set<string>();

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

async function sendSmtpReply(
  config: Record<string, unknown>,
  toEmail: string,
  subject: string,
  body: string
): Promise<void> {
  const smtpHost = String(config.smtpHost ?? "").trim();
  const smtpPort = Number(config.smtpPort ?? 587);
  const smtpUser = String(config.smtpUser ?? "").trim();
  const smtpPass = String(config.smtpPass ?? "").trim();
  const fromAddress = String(config.fromAddress ?? smtpUser).trim();
  const secure = smtpPort === 465;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    subject,
    text: body,
  });
}

async function pollEmailChannels(): Promise<void> {
  const emailChannels = listChannels().filter((c) => c.channel_type === "email" && !!c.enabled);
  if (emailChannels.length === 0) return;

  for (const channel of emailChannels) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(channel.config_json || "{}");
    } catch {
      config = {};
    }

    const imapHost = String(config.imapHost ?? "").trim();
    const imapPort = Number(config.imapPort ?? 993);
    const imapUser = String(config.imapUser ?? "").trim();
    const imapPass = String(config.imapPass ?? "").trim();
    const imapTls = imapPort === 993;

    if (!imapHost || !imapPort || !imapUser || !imapPass) {
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

    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: imapTls,
      auth: {
        user: imapUser,
        pass: imapPass,
      },
      logger: false,
    });

    try {
      await client.connect();
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
              await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
              continue;
            }

            const threadId = resolveChannelThread(channel.id, fromAddress, mappedUser!.id);
            const taggedText = `[External Channel Message from email user \"${fromAddress}\"]\nSubject: ${subject}\n\n${textBody || "(empty)"}`;
            const result = await runAgentLoop(
              threadId,
              taggedText,
              undefined,
              undefined,
              undefined,
              mappedUser!.id
            );

            try {
              await sendSmtpReply(
                config,
                fromAddress,
                `Re: ${subject}`,
                (result.content || "").trim() || "No response content."
              );
            } catch (smtpErr) {
              addLog({
                level: "error",
                source: "email",
                message: `Failed sending SMTP reply for channel \"${channel.label}\": ${smtpErr}`,
                metadata: JSON.stringify({ channelId: channel.id, from: fromAddress }),
              });
            }

            await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
          } catch (messageErr) {
            addLog({
              level: "error",
              source: "email",
              message: `Failed processing inbound email on channel \"${channel.label}\": ${messageErr}`,
              metadata: JSON.stringify({ channelId: channel.id }),
            });
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      addLog({
        level: "error",
        source: "email",
        message: `IMAP poll failed for email channel \"${channel.label}\": ${err}`,
        metadata: JSON.stringify({ channelId: channel.id }),
      });
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore
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
      // Poll the tool for data (assuming list/read-type tools)
      const poll = await executeSchedulerTool(policy.tool_name, {}, mcpManager);
      if (poll.skipped) continue;
      const result = poll.result;
      const polledData = JSON.stringify(result);

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
      const knowledgeContext = knowledgeFacts
        .map((k) => `- ${k.entity} / ${k.attribute}: ${k.value}`)
        .join("\n");

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

      try {
        const assessment = JSON.parse(response.content);

        await ingestKnowledgeFromText({
          source: `mcp:${policy.tool_name}:assessment`,
          text: response.content,
        });

        if (assessment.action_needed) {
          const actionTool = assessment.tool || policy.tool_name;
          const actionPolicy =
            actionTool === policy.tool_name ? policy : getToolPolicy(actionTool);
          const requiresApproval = actionPolicy
            ? actionPolicy.requires_approval !== 0
            : true;
          const actionArgs =
            assessment.args && typeof assessment.args === "object" && !Array.isArray(assessment.args)
              ? (assessment.args as Record<string, unknown>)
              : {};

          addLog({
            level: "info",
            source: "scheduler",
            message: `Proactive action triggered: ${assessment.reasoning}`,
            metadata: JSON.stringify(assessment),
          });

          // Create a proactive thread
          const thread = createThread(`[Proactive] ${policy.tool_name}`);

          addMessage({
            thread_id: thread.id,
            role: "system",
            content: `Proactive scan detected an action from "${policy.tool_name}": ${assessment.reasoning}`,
            tool_calls: null,
            tool_results: null,
            attachments: null,
          });

          if (requiresApproval) {
            createApprovalRequest({
              thread_id: thread.id,
              tool_name: actionTool,
              args: JSON.stringify(actionArgs),
              reasoning: assessment.reasoning,
            });
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
                content: `✅ Proactive action "${actionTool}" completed: ${assessment.reasoning}`,
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
            message: `No action needed for "${policy.tool_name}": ${assessment.summary}`,
            metadata: null,
          });
        }
      } catch {
        addLog({
          level: "warn",
          source: "scheduler",
          message: `Failed to parse LLM assessment for "${policy.tool_name}".`,
          metadata: JSON.stringify({ rawResponse: response.content }),
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
