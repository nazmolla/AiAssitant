/**
 * Built-in Web Tools for Nexus Agent
 *
 * Provides three capabilities:
 *  1. web_search  — Search the web via DuckDuckGo Instant Answer + HTML results
 *  2. web_fetch   — Fetch a URL and extract readable text content
 *  3. web_extract — Fetch a URL and extract structured information with a query focus
 *
 * These are registered as built-in tools alongside MCP tools but execute locally.
 */

import type { ToolDefinition } from "@/lib/llm";
import { URL } from "url";
import { assertExternalUrlWithResolve } from "@/lib/agent/ssrf";
import { getWebSearchProviderConfig, type WebSearchProviderType } from "@/lib/db";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";

// ── Tool Definitions ──────────────────────────────────────────

export const BUILTIN_WEB_TOOLS: ToolDefinition[] = [
  {
    name: "builtin.web_search",
    description:
      "Search the web for information. Returns a list of result titles, URLs, and snippets. Use this when the user asks about current events, facts you don't know, or anything that requires up-to-date information.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default 8, max 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "builtin.web_fetch",
    description:
      "Fetch a web page and extract its readable text content. Use this to read articles, documentation, blog posts, or any web page the user wants information from.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch (must start with http:// or https://).",
        },
        maxLength: {
          type: "number",
          description: "Maximum characters of text to return (default 12000).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "builtin.web_extract",
    description:
      "Fetch a web page and extract information focused on a specific query. Returns relevant sections of the page content. Use this when you need to find specific information within a webpage.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch.",
        },
        query: {
          type: "string",
          description: "What information to look for on the page.",
        },
        maxLength: {
          type: "number",
          description: "Maximum characters to return (default 8000).",
        },
      },
      required: ["url", "query"],
    },
  },
];

// ── Search Result Type ────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchProviderAttempt {
  provider: string;
  error?: string;
  resultCount: number;
}

interface RuntimeSearchProvider {
  type: WebSearchProviderType;
  enabled: boolean;
  priority: number;
  apiKey?: string;
}

// ── User-Agent ────────────────────────────────────────────────

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WEB_SEARCH_TIMEOUT_MS = 15000;


// ── BaseTool class wrapper ────────────────────────────────────

export class WebTools extends BaseTool {
  readonly name = "web";
  readonly toolNamePrefix = "builtin.web_";
  readonly registrationOrder = 0;
  readonly tools = BUILTIN_WEB_TOOLS;
  readonly toolsRequiringApproval: string[] = [];

  static isTool(name: string): boolean {
    return name === "builtin.web_search" || name === "builtin.web_fetch" || name === "builtin.web_extract";
  }

  static async executeBuiltin(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "builtin.web_search": {
        const search = await WebTools.webSearch(
          args.query as string,
          (args.maxResults as number) || 8
        );
        return {
          query: args.query,
          resultCount: search.results.length,
          providerUsed: search.providerUsed,
          attempts: search.attempts,
          results: search.results,
        };
      }

      case "builtin.web_fetch": {
        const content = await WebTools.webFetch(
          args.url as string,
          (args.maxLength as number) || 12000
        );
        return {
          url: args.url,
          contentLength: content.length,
          content,
        };
      }

      case "builtin.web_extract": {
        const content = await WebTools.webExtract(
          args.url as string,
          args.query as string,
          (args.maxLength as number) || 8000
        );
        return {
          url: args.url,
          query: args.query,
          contentLength: content.length,
          content,
        };
      }

      default:
        throw new Error(`Unknown built-in tool: "${name}"`);
    }
  }

  private static decodeBasicEntities(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  private static isAbortLikeError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const maybeError = error as { name?: string; message?: string };
    return maybeError.name === "AbortError" || maybeError.message?.toLowerCase() === "aborted";
  }

  private static async fetchWithTimeout(url: string, accept: string, extraHeaders?: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

    try {
      return await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          ...(extraHeaders || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (WebTools.isAbortLikeError(error)) {
        throw new Error(`Search request timed out after ${WEB_SEARCH_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static parseDuckDuckGoHtmlResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    const resultBlocks = html.split(/class="result\s/);

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i];
      const linkMatch = block.match(
        /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
      );
      if (!linkMatch) continue;

      let url = linkMatch[1];
      const titleHtml = linkMatch[2];

      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      const snippetMatch = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/
      );
      const snippetHtml = snippetMatch ? snippetMatch[1] : "";

      const title = WebTools.decodeBasicEntities(titleHtml.replace(/<[^>]+>/g, "")).trim();
      const snippet = WebTools.decodeBasicEntities(snippetHtml.replace(/<[^>]+>/g, "")).trim();

      if (title && url.startsWith("http")) {
        results.push({ title, url, snippet });
      }
    }

    if (results.length === 0) {
      const linkRegex = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1];
        const title = WebTools.decodeBasicEntities(match[2].replace(/<[^>]+>/g, "")).trim();
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }

        if (!title || !url.startsWith("http")) {
          continue;
        }

        const duplicate = results.some((result) => result.url === url);
        if (!duplicate) {
          results.push({ title, url, snippet: "" });
        }
      }
    }

    return results;
  }

  private static async searchDuckDuckGoHtml(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await WebTools.fetchWithTimeout(searchUrl, "text/html");
    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }
    return WebTools.parseDuckDuckGoHtmlResults(await response.text(), maxResults);
  }

  private static async searchDuckDuckGoInstant(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await WebTools.fetchWithTimeout(searchUrl, "application/json");
    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as {
      Results?: Array<{ FirstURL?: string; Text?: string }>;
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string; Topics?: Array<{ FirstURL?: string; Text?: string }> }>;
    };

    const results: SearchResult[] = [];

    const add = (url?: string, text?: string) => {
      if (!url || !url.startsWith("http") || !text || results.length >= maxResults) return;
      const duplicate = results.some((result) => result.url === url);
      if (duplicate) return;
      results.push({ title: text, url, snippet: text });
    };

    for (const item of payload.Results ?? []) {
      add(item.FirstURL, item.Text);
    }

    for (const item of payload.RelatedTopics ?? []) {
      if (item.Topics && Array.isArray(item.Topics)) {
        for (const nested of item.Topics) {
          add(nested.FirstURL, nested.Text);
        }
      } else {
        add(item.FirstURL, item.Text);
      }
      if (results.length >= maxResults) break;
    }

    return results;
  }

  private static async searchBrave(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
    if (!apiKey.trim()) {
      throw new Error("Missing API key");
    }

    const count = Math.min(Math.max(maxResults, 1), 20);
    const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const response = await WebTools.fetchWithTimeout(searchUrl, "application/json, text/plain, */*", {
      "X-Subscription-Token": apiKey,
    });

    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };

    const results: SearchResult[] = [];
    for (const item of payload.web?.results ?? []) {
      if (!item.url || !item.title) continue;
      if (!item.url.startsWith("http")) continue;
      results.push({
        title: item.title,
        url: item.url,
        snippet: item.description || "",
      });
      if (results.length >= count) break;
    }

    return results;
  }

  private static getRuntimeSearchProviders(): RuntimeSearchProvider[] {
    const configured = getWebSearchProviderConfig();
    return configured
      .map((provider) => ({
        type: provider.type,
        enabled: provider.enabled,
        priority: provider.priority,
        apiKey: provider.apiKey,
      }))
      .sort((left, right) => left.priority - right.priority);
  }

  private static async webSearch(
    query: string,
    maxResults: number = 8
  ): Promise<{ results: SearchResult[]; providerUsed: string; attempts: SearchProviderAttempt[] }> {
    maxResults = Math.min(maxResults, 20);

    const configuredProviders = WebTools.getRuntimeSearchProviders().filter((provider) => provider.enabled);
    const providers: Array<{ name: string; search: (searchQuery: string, limit: number) => Promise<SearchResult[]> }> = configuredProviders.map((provider) => {
      if (provider.type === "duckduckgo-html") {
        return { name: provider.type, search: WebTools.searchDuckDuckGoHtml };
      }
      if (provider.type === "duckduckgo-instant") {
        return { name: provider.type, search: WebTools.searchDuckDuckGoInstant };
      }
      return {
        name: provider.type,
        search: (searchQuery: string, limit: number) => WebTools.searchBrave(searchQuery, limit, provider.apiKey || ""),
      };
    });

    if (providers.length === 0) {
      throw new Error("No enabled search providers configured.");
    }

    const attempts: SearchProviderAttempt[] = [];
    const failures: string[] = [];

    for (const provider of providers) {
      try {
        const providerResults = await provider.search(query, maxResults);
        attempts.push({ provider: provider.name, resultCount: providerResults.length });
        if (providerResults.length > 0) {
          return { results: providerResults, providerUsed: provider.name, attempts };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ provider: provider.name, resultCount: 0, error: message });
        failures.push(`${provider.name}: ${message}`);
      }
    }

    if (failures.length === providers.length) {
      throw new Error(`All search providers failed. ${failures.join(" | ")}`);
    }

    return { results: [], providerUsed: "none", attempts };
  }

  private static async webFetch(
    url: string,
    maxLength: number = 12000
  ): Promise<string> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    await assertExternalUrlWithResolve(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let currentUrl = url;
      let response: Response;
      const MAX_REDIRECTS = 5;

      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        await assertExternalUrlWithResolve(currentUrl);

        response = await fetch(currentUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: controller.signal,
          redirect: "manual",
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) break;
          currentUrl = new URL(location, currentUrl).href;
          if (i === MAX_REDIRECTS) {
            throw new Error("Too many redirects");
          }
          continue;
        }
        break;
      }

      response = response!;

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";

      if (
        !contentType.includes("text/") &&
        !contentType.includes("application/json") &&
        !contentType.includes("application/xml") &&
        !contentType.includes("application/xhtml")
      ) {
        return `[Binary content: ${contentType}, size: ${response.headers.get("content-length") || "unknown"} bytes]`;
      }

      const maxBytes = maxLength * 2;
      const reader = response.body?.getReader();
      if (!reader) {
        return "[No response body]";
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          reader.cancel();
          break;
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));

      if (contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(text);
          return JSON.stringify(parsed, null, 2).slice(0, maxLength);
        } catch {
          return text.slice(0, maxLength);
        }
      }

      return WebTools.extractReadableText(text, maxLength);
    } finally {
      clearTimeout(timeout);
    }
  }

  private static async webExtract(
    url: string,
    query: string,
    maxLength: number = 8000
  ): Promise<string> {
    const fullText = await WebTools.webFetch(url, 50000);
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);

    const paragraphs = fullText.split(/\n\n+/).filter((p) => p.trim().length > 30);

    const scored = paragraphs.map((p) => {
      const lower = p.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (lower.includes(word)) score++;
      }
      return { text: p, score };
    });

    scored.sort((a, b) => b.score - a.score);

    let result = "";
    for (const { text, score } of scored) {
      if (score === 0 && result.length > maxLength / 2) break;
      if (result.length + text.length > maxLength) break;
      result += text + "\n\n";
    }

    return result.trim() || fullText.slice(0, maxLength);
  }

  private static extractReadableText(html: string, maxLength: number): string {
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "");

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    text = text
      .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, "\n\n$2\n\n")
      .replace(/<(p|div|article|section|blockquote)[^>]*>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
      .replace(/<td[^>]*>/gi, " | ")
      .replace(/<tr[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");

    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));

    text = text
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const header = title ? `# ${title}\n\n` : "";
    return (header + text).slice(0, maxLength);
  }

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    return WebTools.executeBuiltin(toolName, args);
  }
}

export const isBuiltinWebTool = WebTools.isTool.bind(WebTools);
export const executeBuiltinWebTool = WebTools.executeBuiltin.bind(WebTools);

export const webTools = new WebTools();
registerToolCategory(webTools);
