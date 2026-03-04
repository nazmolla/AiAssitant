/**
 * Nexus Agent Worker Thread
 *
 * Runs LLM API communication in a separate thread to prevent blocking the
 * main Node.js event loop.  The worker handles:
 *  - Creating LLM SDK clients (OpenAI / Azure / Anthropic / LiteLLM)
 *  - Streaming tokens from the LLM
 *  - The multi-turn tool-call loop (requests tool execution from main thread)
 *
 * The worker does NOT access the database or execute tools directly — all of
 * that stays in the main thread, communicated via IPC.
 *
 * IPC Protocol:
 *   Main → Worker
 *     { type: 'start', config: WorkerConfig }
 *     { type: 'tool_result', requestId, results: ToolResultEntry[] }
 *     { type: 'abort' }
 *
 *   Worker → Main
 *     { type: 'token', data: string }
 *     { type: 'status', data: { step, detail? } }
 *     { type: 'tool_request', requestId, calls, assistantContent }
 *     { type: 'done', data: { content, toolsUsed, iterations } }
 *     { type: 'error', data: string }
 */
'use strict';

const { parentPort, workerData } = require('worker_threads');

/* ── Pending tool-result resolvers ───────────────────────────────── */

const toolResultResolvers = new Map();

function waitForToolResults(requestId) {
  return new Promise((resolve) => {
    toolResultResolvers.set(requestId, resolve);
  });
}

/* ── Message handler ─────────────────────────────────────────────── */

let aborted = false;

parentPort.on('message', async (msg) => {
  if (msg.type === 'start') {
    try {
      await handleStart(msg.config);
    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        data: err && err.message ? err.message : String(err),
      });
    }
  } else if (msg.type === 'tool_result') {
    const resolver = toolResultResolvers.get(msg.requestId);
    if (resolver) {
      toolResultResolvers.delete(msg.requestId);
      resolver(msg.results);
    }
  } else if (msg.type === 'abort') {
    aborted = true;
  }
});

/* ── Initialise LLM client and run the loop ──────────────────────── */

async function handleStart(config) {
  const {
    providerType,
    apiKey,
    model,
    endpoint,
    deployment,
    apiVersion,
    baseURL,
    disableThinking,
    systemPrompt,
    messages,
    tools,
    maxIterations,
  } = config;

  let client;
  let isAnthropic = false;
  const effectiveModel = model || deployment || 'gpt-4o';

  if (providerType === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey });
    isAnthropic = true;
  } else if (providerType === 'azure-openai') {
    const OpenAI = require('openai').default || require('openai');
    const ep = (endpoint || '').replace(/\/$/, '');
    client = new OpenAI({
      apiKey,
      baseURL: `${ep}/openai/deployments/${deployment}`,
      defaultQuery: { 'api-version': apiVersion || '2024-08-01-preview' },
      defaultHeaders: { 'api-key': apiKey },
    });
    isAnthropic = false;
  } else {
    // openai or litellm
    const OpenAI = require('openai').default || require('openai');
    client = new OpenAI({
      apiKey: apiKey || 'no-key-required',
      baseURL: baseURL || undefined,
    });
    isAnthropic = false;
  }

  await runLoop(client, isAnthropic, effectiveModel, {
    systemPrompt,
    messages,
    tools,
    disableThinking: !!disableThinking,
    maxIterations: maxIterations || 25,
  });
}

/* ── LLM Loop ────────────────────────────────────────────────────── */

async function runLoop(client, isAnthropic, model, config) {
  const { systemPrompt, tools, maxIterations, disableThinking } = config;
  const chatMessages = config.messages.map((m) => ({ ...m })); // shallow copy
  let iterations = 0;
  const toolsUsed = [];

  while (iterations < maxIterations) {
    if (aborted) {
      parentPort.postMessage({ type: 'error', data: 'Aborted' });
      return;
    }

    iterations++;

    parentPort.postMessage({
      type: 'status',
      data: {
        step: 'Generating response',
        detail: iterations > 1 ? `Iteration ${iterations}` : undefined,
      },
    });

    let response;
    try {
      response = isAnthropic
        ? await callAnthropic(client, model, systemPrompt, chatMessages, tools)
        : await callOpenAI(client, model, systemPrompt, chatMessages, tools, disableThinking);
    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        data: `LLM call failed: ${err && err.message ? err.message : String(err)}`,
      });
      return;
    }

    // Tool calls → request execution from main thread
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Add assistant message with tool calls to conversation
      chatMessages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      const requestId = `tr_${Date.now()}_${iterations}`;
      parentPort.postMessage({
        type: 'tool_request',
        requestId,
        calls: response.toolCalls,
        assistantContent: response.content,
      });

      // Block (async) until main thread executes the tools and responds
      const results = await waitForToolResults(requestId);
      if (aborted) return;

      for (const r of results) {
        chatMessages.push({
          role: 'tool',
          content: r.content,
          tool_call_id: r.toolCallId,
        });
        if (r.toolName) toolsUsed.push(r.toolName);
      }

      continue; // let the LLM process tool results
    }

    // No tool calls → final response
    parentPort.postMessage({
      type: 'done',
      data: {
        content: response.content || '',
        toolsUsed,
        iterations,
      },
    });
    return;
  }

  // Max iterations
  parentPort.postMessage({
    type: 'done',
    data: {
      content:
        "I've reached the maximum number of tool iterations. Please try rephrasing your request.",
      toolsUsed,
      iterations,
    },
  });
}

/* ── OpenAI / Azure / LiteLLM Streaming ──────────────────────────── */

async function callOpenAI(client, model, systemPrompt, messages, tools, disableThinking) {
  const oaiMessages = [];

  if (systemPrompt) {
    oaiMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      oaiMessages.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id || '',
      });
    } else if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      oaiMessages.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments),
          },
        })),
      });
    } else if (m.contentParts && m.contentParts.length > 0 && m.role === 'user') {
      oaiMessages.push({ role: 'user', content: m.contentParts });
    } else {
      oaiMessages.push({ role: m.role, content: m.content });
    }
  }

  const params = {
    model,
    messages: oaiMessages,
    stream: true,
  };

  if (disableThinking) {
    params.think = false;
  }

  if (tools && tools.length > 0) {
    params.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    params.tool_choice = 'auto';
  }

  let stream;
  try {
    stream = await client.chat.completions.create(params);
  } catch (err) {
    const msg = (err && err.message ? String(err.message) : String(err)).toLowerCase();
    const unsupportedThink = disableThinking && (
      (msg.includes('unknown') && msg.includes('think')) ||
      (msg.includes('invalid') && msg.includes('think')) ||
      (msg.includes('unsupported') && msg.includes('think'))
    );
    if (!unsupportedThink) throw err;
    const retryParams = { ...params };
    delete retryParams.think;
    stream = await client.chat.completions.create(retryParams);
  }

  let content = '';
  const toolCallsMap = new Map();
  let finishReason = 'stop';

  for await (const chunk of stream) {
    if (aborted) throw new Error('Aborted');

    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      parentPort.postMessage({ type: 'token', data: delta.content });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (!toolCallsMap.has(tc.index)) {
          toolCallsMap.set(tc.index, { id: '', name: '', arguments: '' });
        }
        const existing = toolCallsMap.get(tc.index);
        if (tc.id) existing.id = tc.id;
        if (tc.function && tc.function.name) existing.name = tc.function.name;
        if (tc.function && tc.function.arguments)
          existing.arguments += tc.function.arguments;
      }
    }

    if (chunk.choices[0] && chunk.choices[0].finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
  }

  const toolCalls = [];
  for (const [, tc] of toolCallsMap) {
    let args = {};
    try {
      args = JSON.parse(tc.arguments || '{}');
    } catch {
      /* use empty */
    }
    toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
  }

  return { content: content || null, toolCalls, finishReason };
}

/* ── Anthropic Streaming ─────────────────────────────────────────── */

async function callAnthropic(client, model, systemPrompt, messages, tools) {
  const anthropicMessages = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      anthropicMessages.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id || '',
            content: m.content,
          },
        ],
      });
    } else if (m.contentParts && m.contentParts.length > 0 && m.role === 'user') {
      const parts = m.contentParts.map((p) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image_url' && p.image_url) {
          const url = p.image_url.url;
          const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            return {
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            };
          }
          return {
            type: 'image',
            source: { type: 'url', media_type: 'image/jpeg', data: url },
          };
        }
        return { type: 'text', text: `[Attached: ${p.file ? p.file.filename : 'file'}]` };
      });
      anthropicMessages.push({ role: 'user', content: parts });
    } else {
      anthropicMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      });
    }
  }

  const params = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt || undefined,
    messages: anthropicMessages,
  };

  if (tools && tools.length > 0) {
    params.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  const stream = client.messages.stream(params);
  let content = '';

  for await (const event of stream) {
    if (aborted) throw new Error('Aborted');
    if (
      event.type === 'content_block_delta' &&
      event.delta &&
      event.delta.type === 'text_delta'
    ) {
      content += event.delta.text;
      parentPort.postMessage({ type: 'token', data: event.delta.text });
    }
  }

  const finalMessage = await stream.finalMessage();
  const toolCalls = [];

  for (const block of finalMessage.content) {
    if (block.type === 'text' && !content) {
      content = block.text;
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input,
      });
    }
  }

  return {
    content: content || null,
    toolCalls,
    finishReason: finalMessage.stop_reason || 'end_turn',
  };
}
