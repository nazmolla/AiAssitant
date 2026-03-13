/**
 * Built-in Browser Automation Tools for Nexus Agent
 *
 * Uses Playwright to drive a real Chromium browser, enabling:
 *  - Navigate to pages, click elements, fill forms
 *  - Read page content & interactive elements
 *  - Take screenshots for visual understanding
 *  - Upload/download files
 *  - Manage authentication sessions (cookies persist)
 *
 * The browser session persists across tool calls within the agent process,
 * so the agent can perform multi-step workflows (login → search → apply).
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ToolDefinition } from "@/lib/llm";
import * as fs from "fs";
import * as path from "path";
import { assertExternalUrl, assertExternalUrlWithResolve } from "./ssrf";
import { env } from "@/lib/env";

// ── Tool Definitions ──────────────────────────────────────────

/** Browser tools that require owner approval before execution. */
export const BROWSER_TOOLS_REQUIRING_APPROVAL = [
  "builtin.browser_evaluate",
  "builtin.browser_upload",
];

export const BUILTIN_BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: "builtin.browser_navigate",
    description:
      "Open a URL in the browser. Returns the page title and a summary of interactive elements. Use this to start browsing a website.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to navigate to.",
        },
        waitFor: {
          type: "string",
          description:
            "Optional CSS selector to wait for before returning (e.g., '#content', '.results').",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "builtin.browser_click",
    description:
      "Click an element on the page by CSS selector or by visible text. Returns what happened after the click (new URL, page changes, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            'CSS selector of the element to click (e.g., \'button[type="submit"]\', \'a.apply-link\').',
        },
        text: {
          type: "string",
          description:
            'Alternative: click an element containing this visible text (e.g., "Sign In", "Apply Now"). Used when selector is not provided.',
        },
      },
    },
  },
  {
    name: "builtin.browser_type",
    description:
      "Type text into an input field. Can optionally clear the field first. Use this for search boxes, form fields, etc.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: 'CSS selector of the input/textarea (e.g., \'input[name="q"]\', \'#email\').',
        },
        text: {
          type: "string",
          description: "The text to type.",
        },
        clear: {
          type: "boolean",
          description: "Whether to clear the field before typing (default: true).",
        },
        pressEnter: {
          type: "boolean",
          description: "Whether to press Enter after typing (default: false).",
        },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "builtin.browser_fill_form",
    description:
      "Fill multiple form fields at once. Each field is specified as a selector-value pair. More efficient than calling browser_type multiple times.",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "Array of form fields to fill.",
          items: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector for the field." },
              value: { type: "string", description: "Value to fill in." },
              type: {
                type: "string",
                description:
                  'Field type: "text" (default), "select" (dropdown), "checkbox", "file".',
              },
            },
            required: ["selector", "value"],
          },
        },
        submit: {
          type: "boolean",
          description:
            "Whether to submit the form after filling (clicks the submit button). Default: false.",
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "builtin.browser_select",
    description: "Select an option from a dropdown/select element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the <select> element.",
        },
        value: {
          type: "string",
          description: "The option value or visible text to select.",
        },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "builtin.browser_get_content",
    description:
      "Get the text content of the current page or a specific element. Returns readable text extracted from the page. Use this to read what's on the page.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector to scope content extraction (e.g., 'main', '.job-listing', '#results'). If omitted, returns the full page content.",
        },
        maxLength: {
          type: "number",
          description: "Maximum characters to return (default: 10000).",
        },
      },
    },
  },
  {
    name: "builtin.browser_get_elements",
    description:
      "List interactive elements on the current page (links, buttons, inputs, selects). Returns a structured list with selectors and text. Use this to understand what actions are available.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector to scope the search (e.g., 'form', '.sidebar'). Default: entire page.",
        },
        types: {
          type: "array",
          description:
            'Types of elements to include: "links", "buttons", "inputs", "selects", "textareas". Default: all.',
          items: { type: "string" },
        },
        maxResults: {
          type: "number",
          description: "Max number of elements per type (default: 30).",
        },
      },
    },
  },
  {
    name: "builtin.browser_screenshot",
    description:
      "Take a screenshot of the current page. Saves it to disk and returns the file path and a text description of visible elements. Useful for debugging or when you need visual context.",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page (default: false, viewport only).",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to screenshot a specific element.",
        },
      },
    },
  },
  {
    name: "builtin.browser_scroll",
    description: "Scroll the page up or down.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          description: '"down" or "up". Default: "down".',
        },
        amount: {
          type: "number",
          description: "Pixels to scroll (default: 500).",
        },
        selector: {
          type: "string",
          description: "Optional: scroll within a specific scrollable element.",
        },
      },
    },
  },
  {
    name: "builtin.browser_back",
    description: "Navigate back in the browser history.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "builtin.browser_wait",
    description:
      "Wait for a specific condition: an element to appear, a URL change, or a fixed time.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for.",
        },
        timeout: {
          type: "number",
          description: "Maximum time to wait in milliseconds (default: 10000).",
        },
        state: {
          type: "string",
          description: '"visible", "hidden", "attached", "detached" (default: "visible").',
        },
      },
    },
  },
  {
    name: "builtin.browser_upload",
    description: "Upload a file to a file input element on the page.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: 'CSS selector of the file input (e.g., \'input[type="file"]\').',
        },
        filePath: {
          type: "string",
          description: "Absolute path to the file to upload.",
        },
      },
      required: ["selector", "filePath"],
    },
  },
  {
    name: "builtin.browser_evaluate",
    description:
      "Execute JavaScript code in the browser page context. Use for advanced interactions not covered by other tools.",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description:
            "JavaScript code to execute. Can return a value. Example: 'document.title' or 'document.querySelectorAll(\".job\").length'.",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "builtin.browser_close",
    description: "Close the browser session. Call this when done with browser automation.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "builtin.browser_tabs",
    description: "List all open tabs or switch to a specific tab.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: '"list" to list all tabs, "switch" to switch to a tab by index.',
        },
        index: {
          type: "number",
          description: "Tab index to switch to (0-based). Only used with action=switch.",
        },
      },
      required: ["action"],
    },
  },
];

// ── Browser Session Manager ───────────────────────────────────

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");

class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;
  private _lock: Promise<void> = Promise.resolve();

  /** Serialize access to the browser session to prevent concurrent page mutations */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const prev = this._lock;
    this._lock = gate;
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  async getPage(): Promise<Page> {
    if (!this.browser || !this._page || this._page.isClosed()) {
      await this.launch();
    }
    return this._page!;
  }

  private async launch(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
    }

    // Ensure data dirs exist
    const userDataDir = path.join(process.cwd(), "data", "browser-profile");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      javaScriptEnabled: true,
    });

    // Stealth: override navigator.webdriver
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // @ts-ignore
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    this._page = await this.context.newPage();

    // Default timeout
    this._page.setDefaultTimeout(15000);
    this._page.setDefaultNavigationTimeout(30000);
  }

  async close(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.context = null;
      this._page = null;
    }
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  isAlive(): boolean {
    return this.browser !== null && this._page !== null && !this._page.isClosed();
  }
}

// Singleton browser session
let _session: BrowserSession | null = null;

function getSession(): BrowserSession {
  if (!_session) {
    _session = new BrowserSession();
  }
  return _session;
}

// ── Helper: Page Summary ──────────────────────────────────────

async function pageSummary(page: Page): Promise<string> {
  const title = await page.title();
  const url = page.url();
  return `[Page] ${title}\n[URL] ${url}`;
}

async function getInteractiveElements(
  page: Page,
  scope?: string,
  types?: string[],
  max: number = 30
): Promise<string> {
  const include = types || ["links", "buttons", "inputs", "selects", "textareas"];
  const container = scope || "body";
  const lines: string[] = [];

  const elements = await page.evaluate(
    ({ container, include, max }) => {
      const root = document.querySelector(container) || document.body;
      const result: { tag: string; type: string; selector: string; text: string; name: string; placeholder: string; href: string }[] = [];

      function addEls(els: NodeListOf<Element>, tag: string) {
        els.forEach((el) => {
          if (result.length >= max * include.length) return;
          try {
            const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || "";
            const id = el.id ? `#${el.id}` : "";
            const name = el.getAttribute("name") || "";
            // className can be SVGAnimatedString on SVG elements, handle safely
            let cls = "";
            try {
              const cn = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
              if (cn) {
                cls = "." + cn.split(/\s+/).filter((c: string) => c && !c.includes(":") && c.length < 40).slice(0, 2).join(".");
              }
            } catch {}
            const type = el.getAttribute("type") || "";
            const placeholder = el.getAttribute("placeholder") || "";
            const href = el.getAttribute("href") || "";
            const ariaLabel = el.getAttribute("aria-label") || "";
            let selector = el.tagName.toLowerCase();
            if (id) selector += id;
            else if (name) selector += `[name="${name}"]`;
            else if (cls && cls.length > 1) selector += cls;
            else if (type) selector += `[type="${type}"]`;

            result.push({
              tag: el.tagName.toLowerCase(),
              type,
              selector,
              text: text || ariaLabel,
              name,
              placeholder,
              href: href.slice(0, 120),
            });
          } catch {
            // Skip elements that can't be introspected
          }
        });
      }

      if (include.includes("links"))
        addEls(root.querySelectorAll("a[href]"), "a");
      if (include.includes("buttons"))
        addEls(root.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']"), "button");
      if (include.includes("inputs"))
        addEls(root.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button'])"), "input");
      if (include.includes("selects"))
        addEls(root.querySelectorAll("select"), "select");
      if (include.includes("textareas"))
        addEls(root.querySelectorAll("textarea"), "textarea");

      return result;
    },
    { container, include, max }
  );

  if (!elements.length) return "(no interactive elements found)";

  for (const el of elements) {
    let desc = `  [${el.tag}]`;
    if (el.type) desc += ` type=${el.type}`;
    desc += ` selector="${el.selector}"`;
    if (el.text) desc += ` text="${el.text.slice(0, 60)}"`;
    if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
    if (el.href) desc += ` href="${el.href}"`;
    lines.push(desc);
  }

  return lines.join("\n");
}

// ── Tool Executor ─────────────────────────────────────────────

export function isBrowserTool(name: string): boolean {
  return name.startsWith("builtin.browser_");
}

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const session = getSession();

  // Serialize browser operations to prevent concurrent page mutations
  return session.withLock(() => _executeBrowserToolInner(session, name, args));
}

async function _executeBrowserToolInner(
  session: BrowserSession,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    // ── Navigate ────────────────────────────────────────────
    case "builtin.browser_navigate": {
      const page = await session.getPage();
      const url = args.url as string;

      // SSRF protection: block internal/private URLs with DNS rebinding defence
      await assertExternalUrlWithResolve(url);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (navErr: any) {
        // Retry once with networkidle
        try {
          await page.goto(url, { waitUntil: "commit", timeout: 30000 });
        } catch {
          throw new Error(`Failed to navigate to ${url}: ${navErr.message}`);
        }
      }

      if (args.waitFor) {
        try {
          await page.waitForSelector(args.waitFor as string, { timeout: 10000 });
        } catch {}
      }
      // Small settling delay
      await page.waitForTimeout(1500);

      const title = await page.title();
      const currentUrl = page.url();

      // Get visible page text (first ~3000 chars) so the LLM understands what loaded
      let pageText = "";
      try {
        pageText = await page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, footer, noscript, svg, iframe").forEach(el => el.remove());
          return (clone.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        });
        pageText = pageText.slice(0, 3000);
      } catch {}

      // Get interactive elements (limited)
      const elements = await getInteractiveElements(page, undefined, undefined, 15);

      return {
        status: "navigated",
        title,
        url: currentUrl,
        redirected: currentUrl !== url,
        pageTextPreview: pageText,
        interactiveElements: elements,
      };
    }

    // ── Click ───────────────────────────────────────────────
    case "builtin.browser_click": {
      const page = await session.getPage();
      const beforeUrl = page.url();

      if (args.selector) {
        await page.click(args.selector as string);
      } else if (args.text) {
        await page.getByText(args.text as string, { exact: false }).first().click();
      } else {
        throw new Error("Either 'selector' or 'text' must be provided.");
      }

      await page.waitForTimeout(1500);

      const afterUrl = page.url();
      const summary = await pageSummary(page);
      return {
        status: "clicked",
        urlChanged: beforeUrl !== afterUrl,
        ...parsePageInfo(summary),
      };
    }

    // ── Type ────────────────────────────────────────────────
    case "builtin.browser_type": {
      const page = await session.getPage();
      const selector = args.selector as string;
      const text = args.text as string;
      const clear = args.clear !== false;
      const pressEnter = args.pressEnter === true;

      if (clear) {
        await page.fill(selector, "");
      }
      await page.type(selector, text, { delay: 30 });

      if (pressEnter) {
        await page.press(selector, "Enter");
        await page.waitForTimeout(2000);
      }

      const summary = await pageSummary(page);
      return {
        status: "typed",
        selector,
        pressedEnter: pressEnter,
        ...parsePageInfo(summary),
      };
    }

    // ── Fill Form ───────────────────────────────────────────
    case "builtin.browser_fill_form": {
      const page = await session.getPage();
      const fields = args.fields as Array<{
        selector: string;
        value: string;
        type?: string;
      }>;

      const results: string[] = [];
      for (const field of fields) {
        try {
          const fieldType = field.type || "text";
          switch (fieldType) {
            case "select":
              try {
                await page.selectOption(field.selector, { label: field.value });
              } catch {
                await page.selectOption(field.selector, field.value);
              }
              results.push(`✓ Selected "${field.value}" in ${field.selector}`);
              break;
            case "checkbox":
              if (field.value === "true" || field.value === "check") {
                await page.check(field.selector);
              } else {
                await page.uncheck(field.selector);
              }
              results.push(`✓ Checkbox ${field.selector} set to ${field.value}`);
              break;
            case "file":
              await page.setInputFiles(field.selector, field.value);
              results.push(`✓ File "${field.value}" attached to ${field.selector}`);
              break;
            default:
              await page.fill(field.selector, field.value);
              results.push(`✓ Filled ${field.selector} with "${field.value.slice(0, 40)}..."`);
          }
        } catch (err: any) {
          results.push(`✗ Failed ${field.selector}: ${err.message}`);
        }
      }

      if (args.submit) {
        try {
          // Try common submit strategies
          const submitBtn = await page.$(
            'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply"), button:has-text("Save"), button:has-text("Send")'
          );
          if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
            results.push("✓ Form submitted");
          } else {
            results.push("✗ No submit button found");
          }
        } catch (err: any) {
          results.push(`✗ Submit failed: ${err.message}`);
        }
      }

      const summary = await pageSummary(page);
      return {
        status: "form_filled",
        ...parsePageInfo(summary),
        fieldResults: results,
      };
    }

    // ── Select Dropdown ─────────────────────────────────────
    case "builtin.browser_select": {
      const page = await session.getPage();
      try {
        await page.selectOption(args.selector as string, { label: args.value as string });
      } catch {
        await page.selectOption(args.selector as string, args.value as string);
      }
      return { status: "selected", selector: args.selector, value: args.value };
    }

    // ── Get Content ─────────────────────────────────────────
    case "builtin.browser_get_content": {
      const page = await session.getPage();
      const maxLen = (args.maxLength as number) || 10000;
      let text: string;

      if (args.selector) {
        const el = await page.$(args.selector as string);
        text = el ? (await el.innerText()) || "" : "(element not found)";
      } else {
        text = await page.evaluate(() => {
          // Remove scripts, styles, nav, footer for cleaner text
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, footer, noscript, svg").forEach((el) => el.remove());
          return clone.innerText || "";
        });
      }

      // Clean up excessive whitespace
      text = text
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maxLen);

      const summary = await pageSummary(page);
      return {
        ...parsePageInfo(summary),
        contentLength: text.length,
        content: text,
      };
    }

    // ── Get Interactive Elements ────────────────────────────
    case "builtin.browser_get_elements": {
      const page = await session.getPage();
      const elements = await getInteractiveElements(
        page,
        args.selector as string | undefined,
        args.types as string[] | undefined,
        (args.maxResults as number) || 30
      );
      const summary = await pageSummary(page);
      return {
        ...parsePageInfo(summary),
        elements,
      };
    }

    // ── Screenshot ──────────────────────────────────────────
    case "builtin.browser_screenshot": {
      const page = await session.getPage();
      const timestamp = Date.now();
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);

      if (args.selector) {
        const el = await page.$(args.selector as string);
        if (el) {
          await el.screenshot({ path: filepath });
        } else {
          throw new Error(`Element not found: ${args.selector}`);
        }
      } else {
        await page.screenshot({
          path: filepath,
          fullPage: args.fullPage === true,
        });
      }

      const summary = await pageSummary(page);
      return {
        status: "screenshot_taken",
        ...parsePageInfo(summary),
        screenshotPath: filepath,
        relativePath: `data/screenshots/${filename}`,
      };
    }

    // ── Scroll ──────────────────────────────────────────────
    case "builtin.browser_scroll": {
      const page = await session.getPage();
      const direction = (args.direction as string) || "down";
      const amount = (args.amount as number) || 500;
      const delta = direction === "up" ? -amount : amount;

      if (args.selector) {
        await page.evaluate(
          ({ sel, d }) => {
            const el = document.querySelector(sel);
            if (el) el.scrollBy(0, d);
          },
          { sel: args.selector as string, d: delta }
        );
      } else {
        await page.evaluate((d) => window.scrollBy(0, d), delta);
      }

      await page.waitForTimeout(500);
      return { status: "scrolled", direction, pixels: amount };
    }

    // ── Back ────────────────────────────────────────────────
    case "builtin.browser_back": {
      const page = await session.getPage();
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const summary = await pageSummary(page);
      return { status: "navigated_back", ...parsePageInfo(summary) };
    }

    // ── Wait ────────────────────────────────────────────────
    case "builtin.browser_wait": {
      const page = await session.getPage();
      const timeout = (args.timeout as number) || 10000;

      if (args.selector) {
        const state = (args.state as "visible" | "hidden" | "attached" | "detached") || "visible";
        await page.waitForSelector(args.selector as string, { timeout, state });
        return { status: "element_found", selector: args.selector };
      }

      // Fixed wait
      await page.waitForTimeout(timeout);
      return { status: "waited", ms: timeout };
    }

    // ── Upload File ─────────────────────────────────────────
    case "builtin.browser_upload": {
      const page = await session.getPage();
      const filePath = args.filePath as string;
      // Restrict file uploads to the FS_ALLOWED_ROOT to prevent exfiltration of sensitive files
      const FS_ALLOWED_ROOT = env.FS_ALLOWED_ROOT;
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(FS_ALLOWED_ROOT + path.sep) && resolved !== FS_ALLOWED_ROOT) {
        throw new Error(`Access denied: file path "${filePath}" is outside the allowed root directory.`);
      }
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }
      await page.setInputFiles(args.selector as string, resolved);
      return { status: "file_uploaded", filePath: resolved, selector: args.selector };
    }

    // ── Evaluate JS ─────────────────────────────────────────
    case "builtin.browser_evaluate": {
      const page = await session.getPage();
      const result = await page.evaluate((code: string) => {
        try {
           
          return eval(code);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }, args.script as string);
      return {
        status: "evaluated",
        result: typeof result === "object" ? JSON.stringify(result) : String(result),
      };
    }

    // ── Close ───────────────────────────────────────────────
    case "builtin.browser_close": {
      await session.close();
      return { status: "browser_closed" };
    }

    // ── Tabs ────────────────────────────────────────────────
    case "builtin.browser_tabs": {
      const ctx = session.getContext();
      if (!ctx) {
        return { status: "no_browser", tabs: [] };
      }
      const pages = ctx.pages();

      if (args.action === "list") {
        const tabs = await Promise.all(
          pages.map(async (p, i) => ({
            index: i,
            url: p.url(),
            title: await p.title(),
          }))
        );
        return { status: "listed", tabs };
      }

      if (args.action === "switch" && typeof args.index === "number") {
        const targetPage = pages[args.index as number];
        if (!targetPage) {
          throw new Error(`Tab index ${args.index} not found. Total tabs: ${pages.length}`);
        }
        await targetPage.bringToFront();
        const summary = await pageSummary(targetPage);
        return { status: "switched", ...parsePageInfo(summary) };
      }

      throw new Error('action must be "list" or "switch".');
    }

    default:
      throw new Error(`Unknown browser tool: "${name}"`);
  }
}

// ── Helper ────────────────────────────────────────────────────

function parsePageInfo(summary: string): { title: string; url: string } {
  const titleMatch = summary.match(/\[Page\] (.*)/);
  const urlMatch = summary.match(/\[URL\] (.*)/);
  return {
    title: titleMatch ? titleMatch[1] : "",
    url: urlMatch ? urlMatch[1] : "",
  };
}

/**
 * Close browser on process exit.
 */
process.on("beforeExit", async () => {
  if (_session) {
    await _session.close();
  }
});
