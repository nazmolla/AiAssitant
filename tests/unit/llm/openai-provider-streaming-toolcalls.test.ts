/**
 * @jest-environment node
 */

const createMock = jest.fn();

jest.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { OpenAIChatProvider } from "@/lib/llm/openai-provider";

describe("OpenAIChatProvider streaming tool call assembly", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  test("merges delayed tool call id/name chunks and returns valid tool call id", async () => {
    async function* streamChunks() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: "{\"agentTypeId\":\"web_researcher\"," },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc123",
                  function: {
                    name: "builtin.dispatch_agent",
                    arguments: "\"task\":\"find jobs\"}",
                  },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      };
    }

    createMock.mockResolvedValue(streamChunks());

    const provider = new OpenAIChatProvider({
      variant: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });

    const response = await provider.chat(
      [{ role: "user", content: "delegate this" }],
      [],
      undefined,
      async () => undefined,
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].id).toBe("call_abc123");
    expect(response.toolCalls[0].name).toBe("builtin.dispatch_agent");
    expect(response.toolCalls[0].arguments).toEqual({
      agentTypeId: "web_researcher",
      task: "find jobs",
    });
  });

  test("generates fallback tool call id when provider stream never emits one", async () => {
    async function* streamChunks() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    name: "builtin.dispatch_agent",
                    arguments: "{\"agentTypeId\":\"web_researcher\",\"task\":\"find jobs\"}",
                  },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      };
    }

    createMock.mockResolvedValue(streamChunks());

    const provider = new OpenAIChatProvider({
      variant: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });

    const response = await provider.chat(
      [{ role: "user", content: "delegate this" }],
      [],
      undefined,
      async () => undefined,
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].id).toMatch(/^tool_call_/);
    expect(response.toolCalls[0].name).toBe("builtin.dispatch_agent");
    expect(response.toolCalls[0].arguments).toEqual({
      agentTypeId: "web_researcher",
      task: "find jobs",
    });
  });
});
