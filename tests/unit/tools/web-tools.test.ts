import { executeBuiltinWebTool } from "@/lib/tools/web-tools";

const mockGetWebSearchProviderConfig = jest.fn();

jest.mock("@/lib/db", () => ({
  getWebSearchProviderConfig: () => mockGetWebSearchProviderConfig(),
}));

describe("builtin.web_search runtime behavior", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  beforeEach(() => {
    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-html", enabled: true, priority: 1 },
      { type: "duckduckgo-instant", enabled: true, priority: 2 },
      { type: "brave", enabled: false, priority: 3 },
    ]);
  });

  test("normalizes provider aborts into explicit timeout error details", async () => {
    global.fetch = jest.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as typeof fetch;

    const pending = executeBuiltinWebTool("builtin.web_search", {
      query: "senior software engineer jobs",
    });

    await expect(pending).rejects.toThrow("All search providers failed");
    await expect(pending).rejects.toThrow("Search request timed out");
  });

  test("falls back to secondary provider when primary returns empty", async () => {
    global.fetch = jest
      .fn(async (url: string | URL | globalThis.Request) => {
        const normalized = String(url);

        if (normalized.includes("html.duckduckgo.com")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => "<html><body><div>No result blocks</div></body></html>",
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            Results: [
              {
                FirstURL: "https://example.org/jobs/123",
                Text: "Senior Engineer role - Example Org",
              },
            ],
          }),
        } as Response;
      }) as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "senior engineer jobs",
      maxResults: 5,
    }) as {
      resultCount: number;
      providerUsed: string;
      attempts: Array<{ provider: string; resultCount: number; error?: string }>;
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    expect(result.providerUsed).toBe("duckduckgo-instant");
    expect(result.resultCount).toBe(1);
    expect(result.attempts[0]).toEqual(expect.objectContaining({ provider: "duckduckgo-html", resultCount: 0 }));
    expect(result.attempts[1]).toEqual(expect.objectContaining({ provider: "duckduckgo-instant", resultCount: 1 }));
    expect(result.results[0].url).toBe("https://example.org/jobs/123");
  });

  test("falls back to brave provider when DuckDuckGo providers fail", async () => {
    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-html", enabled: true, priority: 1 },
      { type: "duckduckgo-instant", enabled: true, priority: 2 },
      { type: "brave", enabled: true, priority: 3, apiKey: "brv-token" },
    ]);

    global.fetch = jest
      .fn(async (url: string | URL | globalThis.Request) => {
        const normalized = String(url);
        if (normalized.includes("html.duckduckgo.com")) {
          return {
            ok: false,
            status: 502,
            statusText: "Bad Gateway",
          } as Response;
        }
        if (normalized.includes("api.duckduckgo.com")) {
          return {
            ok: false,
            status: 500,
            statusText: "Failure",
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            web: {
              results: [
                {
                  title: "Brave listing",
                  url: "https://example.com/brave-job",
                  description: "fallback result",
                },
              ],
            },
          }),
        } as Response;
      }) as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "ml engineer",
      maxResults: 5,
    }) as {
      providerUsed: string;
      resultCount: number;
      attempts: Array<{ provider: string; resultCount: number; error?: string }>;
    };

    expect(result.providerUsed).toBe("brave");
    expect(result.resultCount).toBe(1);
    expect(result.attempts.map((attempt) => attempt.provider)).toEqual([
      "duckduckgo-html",
      "duckduckgo-instant",
      "brave",
    ]);
  });

  test("parses DuckDuckGo markup variant through fallback parser", async () => {
    const html = `
      <html>
        <body>
          <h2><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fjob-1">Senior &amp; Staff Engineer</a></h2>
        </body>
      </html>
    `;

    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => html,
      } as Response;
    }) as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "engineer jobs",
      maxResults: 3,
    }) as { resultCount: number; results: Array<{ title: string; url: string; snippet: string }> };

    expect(result.resultCount).toBe(1);
    expect(result.results[0].title).toBe("Senior & Staff Engineer");
    expect(result.results[0].url).toBe("https://example.com/job-1");
  });
});
