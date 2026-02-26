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
import { assertExternalUrl, assertExternalUrlWithResolve } from "./ssrf";

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

// ── User-Agent ────────────────────────────────────────────────

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Web Search Implementation ─────────────────────────────────

async function webSearch(
  query: string,
  maxResults: number = 8
): Promise<SearchResult[]> {
  maxResults = Math.min(maxResults, 20);

  // Use DuckDuckGo HTML search (no API key needed)
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse DuckDuckGo HTML results
  // Results are in <div class="result"> blocks
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // Extract title and URL from the result link
    const linkMatch = block.match(
      /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!linkMatch) continue;

    let url = linkMatch[1];
    const titleHtml = linkMatch[2];

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // Extract snippet
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/
    );
    const snippetHtml = snippetMatch ? snippetMatch[1] : "";

    // Strip HTML tags
    const title = titleHtml.replace(/<[^>]+>/g, "").trim();
    const snippet = snippetHtml.replace(/<[^>]+>/g, "").trim();

    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

// ── Web Fetch Implementation ──────────────────────────────────

async function webFetch(
  url: string,
  maxLength: number = 12000
): Promise<string> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http:// or https://");
  }

  // Resolve DNS and verify resolved IPs are not private (prevents DNS rebinding)
  await assertExternalUrlWithResolve(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // Use manual redirect to re-validate each hop against SSRF blocklist
    let currentUrl = url;
    let response: Response;
    const MAX_REDIRECTS = 5;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      // Re-resolve DNS on each redirect to prevent rebinding mid-chain
      await assertExternalUrlWithResolve(currentUrl);

      response = await fetch(currentUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "manual",
      });

      // Follow redirects manually with SSRF re-validation
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

    // If it's not HTML/text, just report the content type
    if (
      !contentType.includes("text/") &&
      !contentType.includes("application/json") &&
      !contentType.includes("application/xml") &&
      !contentType.includes("application/xhtml")
    ) {
      return `[Binary content: ${contentType}, size: ${response.headers.get("content-length") || "unknown"} bytes]`;
    }

    // Stream response with size limit to prevent memory exhaustion (max 2x maxLength)
    const MAX_BYTES = maxLength * 2;
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
      if (totalBytes > MAX_BYTES) {
        reader.cancel();
        break;
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));

    // If JSON, return formatted
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2).slice(0, maxLength);
      } catch {
        return text.slice(0, maxLength);
      }
    }

    // Extract readable text from HTML
    return extractReadableText(text, maxLength);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Web Extract (focused fetch) ───────────────────────────────

async function webExtract(
  url: string,
  query: string,
  maxLength: number = 8000
): Promise<string> {
  const fullText = await webFetch(url, 50000); // get more text for filtering
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Split text into paragraphs and score by relevance
  const paragraphs = fullText.split(/\n\n+/).filter((p) => p.trim().length > 30);

  const scored = paragraphs.map((p) => {
    const lower = p.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (lower.includes(word)) score++;
    }
    return { text: p, score };
  });

  // Sort by relevance, keep top ones
  scored.sort((a, b) => b.score - a.score);

  let result = "";
  for (const { text, score } of scored) {
    if (score === 0 && result.length > maxLength / 2) break;
    if (result.length + text.length > maxLength) break;
    result += text + "\n\n";
  }

  return result.trim() || fullText.slice(0, maxLength);
}

// ── HTML → Readable Text ──────────────────────────────────────

function extractReadableText(html: string, maxLength: number): string {
  // Remove scripts, styles, and other non-content elements
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

  // Convert structural HTML to newlines
  text = text
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, "\n\n$2\n\n")
    .replace(/<(p|div|article|section|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<tr[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));

  // Clean up whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const header = title ? `# ${title}\n\n` : "";
  return (header + text).slice(0, maxLength);
}

// ── Tool Executor ─────────────────────────────────────────────

/**
 * Check whether a tool name is a built-in web tool.
 */
export function isBuiltinWebTool(name: string): boolean {
  return name === "builtin.web_search" || name === "builtin.web_fetch" || name === "builtin.web_extract";
}

/**
 * Execute a built-in web tool and return the result.
 */
export async function executeBuiltinWebTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "builtin.web_search": {
      const results = await webSearch(
        args.query as string,
        (args.maxResults as number) || 8
      );
      return {
        query: args.query,
        resultCount: results.length,
        results,
      };
    }

    case "builtin.web_fetch": {
      const content = await webFetch(
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
      const content = await webExtract(
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
