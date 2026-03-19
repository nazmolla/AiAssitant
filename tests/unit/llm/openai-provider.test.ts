/**
 * Unit tests — OpenAI Provider SDK configuration
 *
 * Validates that the OpenAI/Azure SDK clients are created with
 * appropriate timeout and retry settings for snappy chat responses.
 */

// Capture the options passed to the OpenAI constructor
const constructorCalls: Array<Record<string, unknown>> = [];

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: class MockOpenAI {
      constructor(opts: Record<string, unknown>) {
        constructorCalls.push(opts);
      }
      chat = { completions: { create: jest.fn() } };
    },
  };
});

import { OpenAIChatProvider } from "@/lib/llm/openai-provider";

describe("OpenAIChatProvider — SDK configuration", () => {
  beforeEach(() => {
    constructorCalls.length = 0;
  });

  test("standard OpenAI client uses 120s timeout and 1 retry", () => {
    new OpenAIChatProvider({
      variant: "openai",
      apiKey: "sk-test",
      model: "gpt-4o",
    });

    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0].timeout).toBe(120_000);
    expect(constructorCalls[0].maxRetries).toBe(1);
  });

  test("Azure OpenAI client uses 120s timeout and 1 retry", () => {
    new OpenAIChatProvider({
      variant: "azure",
      apiKey: "azure-key-test",
      endpoint: "https://my-resource.openai.azure.com",
      deployment: "gpt-4o",
    });

    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0].timeout).toBe(120_000);
    expect(constructorCalls[0].maxRetries).toBe(1);
  });

  test("timeout is not the old 15s or 60s value", () => {
    new OpenAIChatProvider({
      variant: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    expect(constructorCalls[0].timeout).not.toBe(15_000);
    expect(constructorCalls[0].timeout).not.toBe(60_000);
  });
});
