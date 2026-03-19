import { executeBuiltinWebTool } from "@/lib/tools/web-tools";

const mockGetWebSearchProviderConfig = jest.fn();

jest.mock("@/lib/db/search-provider-queries", () => ({
  getWebSearchProviderConfig: () => mockGetWebSearchProviderConfig(),
}));

jest.mock("@/lib/agent/ssrf", () => ({
  assertExternalUrlWithResolve: jest.fn().mockResolvedValue(undefined),
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

  test("returns results from first provider without trying others", async () => {
    const ddgHtml = `
      <div class="result results_links_deep">
        <a class="result__a" href="https://example.com/first-result">First Result Title</a>
        <a class="result__snippet">A good snippet here.</a>
      </div>
    `;

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => ddgHtml,
    })) as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "test query",
      maxResults: 5,
    }) as { providerUsed: string; attempts: unknown[] };

    expect(result.providerUsed).toBe("duckduckgo-html");
    expect(result.attempts).toHaveLength(1);
  });

  test("throws when no providers are enabled", async () => {
    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-html", enabled: false, priority: 1 },
    ]);

    await expect(
      executeBuiltinWebTool("builtin.web_search", { query: "anything" })
    ).rejects.toThrow("No enabled search providers configured.");
  });

  test("returns structured response with query metadata", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        Results: [{ FirstURL: "https://example.com/res", Text: "Example result" }],
      }),
    })) as typeof fetch;

    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-instant", enabled: true, priority: 1 },
    ]);

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "my query",
    }) as { query: string; resultCount: number; results: Array<{ url: string }> };

    expect(result.query).toBe("my query");
    expect(result.resultCount).toBe(1);
    expect(result.results[0].url).toBe("https://example.com/res");
  });

  test("parses DuckDuckGo HTML result blocks with snippet", async () => {
    const html = `
<html><body>
<div class="result results_links">
  <a class="result__a" href="https://jobs.example.com/listing/42">Software Engineer — Jobs Example</a>
  <a class="result__snippet">We are looking for a skilled engineer to join our team.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fother.example.com%2Fcareers">Other Corp Careers</a>
  <a class="result__snippet">Apply for open roles at Other Corp.</a>
</div>
</body></html>`;

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => html,
    })) as typeof fetch;

    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-html", enabled: true, priority: 1 },
    ]);

    const result = await executeBuiltinWebTool("builtin.web_search", {
      query: "software engineer jobs",
      maxResults: 5,
    }) as { resultCount: number; results: Array<{ title: string; url: string }> };

    expect(result.resultCount).toBeGreaterThanOrEqual(1);
    const urls = result.results.map((r) => r.url);
    expect(urls.some((u) => u.includes("example.com"))).toBe(true);
  });

  test("all providers fail — throws aggregated error", async () => {
    mockGetWebSearchProviderConfig.mockReturnValue([
      { type: "duckduckgo-html", enabled: true, priority: 1 },
      { type: "duckduckgo-instant", enabled: true, priority: 2 },
    ]);

    global.fetch = jest.fn(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    await expect(
      executeBuiltinWebTool("builtin.web_search", { query: "fail test" })
    ).rejects.toThrow("All search providers failed");
  });
});

describe("builtin.web_fetch runtime behavior", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test("returns extracted text content from HTML page", async () => {
    const html = `<html><head><title>Test Page</title></head><body><p>Hello world content here.</p></body></html>`;

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html" }),
      body: {
        getReader: () => {
          const enc = new TextEncoder().encode(html);
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: enc };
            },
            cancel: jest.fn(),
          };
        },
      },
    })) as unknown as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_fetch", {
      url: "https://example.com/page",
    }) as { url: string; content: string; contentLength: number };

    expect(result.url).toBe("https://example.com/page");
    expect(result.content).toContain("Hello world content here");
    expect(result.contentLength).toBeGreaterThan(0);
  });

  test("throws for non-http URLs", async () => {
    await expect(
      executeBuiltinWebTool("builtin.web_fetch", { url: "ftp://example.com" })
    ).rejects.toThrow("URL must start with http://");
  });

  test("returns binary content descriptor for non-text responses", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png", "content-length": "2048" }),
      body: { getReader: () => ({ read: async () => ({ done: true }), cancel: jest.fn() }) },
    })) as unknown as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_fetch", {
      url: "https://example.com/image.png",
    }) as { content: string };

    expect(result.content).toMatch(/Binary content/);
    expect(result.content).toContain("image/png");
  });

  test("returns JSON pretty-printed for JSON responses", async () => {
    const payload = { key: "value", count: 42 };

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => {
          const enc = new TextEncoder().encode(JSON.stringify(payload));
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: enc };
            },
            cancel: jest.fn(),
          };
        },
      },
    })) as unknown as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_fetch", {
      url: "https://api.example.com/data",
    }) as { content: string };

    const parsed = JSON.parse(result.content);
    expect(parsed.key).toBe("value");
    expect(parsed.count).toBe(42);
  });

  test("throws when fetch returns non-ok status", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers({}),
    })) as unknown as typeof fetch;

    await expect(
      executeBuiltinWebTool("builtin.web_fetch", { url: "https://example.com/missing" })
    ).rejects.toThrow("Fetch failed: 404");
  });
});

describe("builtin.web_extract runtime behavior", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test("extracts paragraphs relevant to query", async () => {
    const html = `<html><body>
      <p>This paragraph is about TypeScript and type safety in modern applications.</p>
      <p>Bananas are yellow fruit commonly found in tropical regions.</p>
      <p>TypeScript provides excellent tooling for large codebases and type checking.</p>
    </body></html>`;

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html" }),
      body: {
        getReader: () => {
          const enc = new TextEncoder().encode(html);
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: enc };
            },
            cancel: jest.fn(),
          };
        },
      },
    })) as unknown as typeof fetch;

    const result = await executeBuiltinWebTool("builtin.web_extract", {
      url: "https://example.com/article",
      query: "TypeScript type safety",
    }) as { url: string; query: string; content: string; contentLength: number };

    expect(result.url).toBe("https://example.com/article");
    expect(result.query).toBe("TypeScript type safety");
    expect(result.content.toLowerCase()).toContain("typescript");
    expect(result.contentLength).toBeGreaterThan(0);
  });
});

describe("executeBuiltinWebTool — unknown tool", () => {
  test("throws for unknown tool name", async () => {
    await expect(
      executeBuiltinWebTool("builtin.unknown_tool", {})
    ).rejects.toThrow('Unknown built-in tool: "builtin.unknown_tool"');
  });
});
