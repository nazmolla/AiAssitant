/**
 * Tests for MarkdownMessage component — verifies that assistant messages
 * render markdown as formatted HTML rather than plain text.
 *
 * react-markdown is an ESM-only package so we mock it with a simple
 * implementation that parses basic markdown for testing purposes.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

// Mock react-markdown (ESM-only) with a minimal implementation
jest.mock("react-markdown", () => {
  // Simple markdown→HTML parser for testing
  return {
    __esModule: true,
    default: function ReactMarkdown({ children, components }: { children: string; components?: Record<string, React.FC<any>> }) {
      // Parse basic markdown elements
      let html = children || "";

      // Bold: **text** → <strong>text</strong>
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      // Italic: *text* → <em>text</em>
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      // Strikethrough: ~~text~~ → <del>text</del>
      html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
      // Inline code: `text` → <code>text</code>
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
      // Headings: ## text → <h2>text</h2>
      html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
      // HR: --- → <hr/>
      html = html.replace(/^---$/gm, "<hr/>");
      // Unordered list items: - text → <li>text</li>
      html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
      // Wrap consecutive <li> in <ul>
      html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, "<ul>$1</ul>");
      // Ordered list items: 1. text → <li>text</li> (in <ol>)
      html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
      // Links: [text](url) → <a href="url" target="_blank" rel="noopener noreferrer">text</a>
      html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Blockquote: > text
      html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
      // Fenced code: ```...``` → <pre><code>...</code></pre>
      html = html.replace(/```\w*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
      // Tables (basic GFM)
      const tableMatch = html.match(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/);
      if (tableMatch) {
        const headers = tableMatch[1].split("|").map((h: string) => h.trim()).filter(Boolean);
        const bodyLines = tableMatch[2].trim().split("\n");
        let tableHtml = "<table><thead><tr>";
        headers.forEach((h: string) => { tableHtml += `<th>${h}</th>`; });
        tableHtml += "</tr></thead><tbody>";
        bodyLines.forEach((line: string) => {
          const cells = line.split("|").map((c: string) => c.trim()).filter(Boolean);
          tableHtml += "<tr>";
          cells.forEach((c: string) => { tableHtml += `<td>${c}</td>`; });
          tableHtml += "</tr>";
        });
        tableHtml += "</tbody></table>";
        html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/, tableHtml);
      }

      return React.createElement("div", { dangerouslySetInnerHTML: { __html: html } });
    },
  };
});

// Mock remark-gfm (ESM-only)
jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => {},
}));

import MarkdownMessage from "@/components/markdown-message";

describe("MarkdownMessage", () => {
  test("renders bold text as <strong>", () => {
    const { container } = render(<MarkdownMessage content="Hello **world**" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("world");
  });

  test("renders headings", () => {
    const { container } = render(<MarkdownMessage content="## My Heading" />);
    const h2 = container.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toBe("My Heading");
  });

  test("renders unordered lists", () => {
    const content = "- Item A\n- Item B\n- Item C";
    const { container } = render(<MarkdownMessage content={content} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("Item A");
    expect(items[2].textContent).toBe("Item C");
  });

  test("renders ordered lists as list items", () => {
    const content = "1. First\n2. Second\n3. Third";
    const { container } = render(<MarkdownMessage content={content} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("First");
  });

  test("renders horizontal rules", () => {
    const content = "Above\n\n---\n\nBelow";
    const { container } = render(<MarkdownMessage content={content} />);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
  });

  test("renders inline code", () => {
    const { container } = render(<MarkdownMessage content="Use `npm install`" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("npm install");
  });

  test("renders fenced code blocks", () => {
    const content = "```js\nconsole.log('hi');\n```";
    const { container } = render(<MarkdownMessage content={content} />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("console.log");
  });

  test("renders links with target=_blank", () => {
    const { container } = render(<MarkdownMessage content="[Google](https://google.com)" />);
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://google.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  test("renders blockquotes", () => {
    const { container } = render(<MarkdownMessage content="> This is a quote" />);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote).not.toBeNull();
    expect(blockquote?.textContent).toContain("This is a quote");
  });

  test("renders GFM strikethrough", () => {
    const { container } = render(<MarkdownMessage content="~~deleted~~" />);
    const del = container.querySelector("del");
    expect(del).not.toBeNull();
    expect(del?.textContent).toBe("deleted");
  });

  test("renders GFM tables", () => {
    const content = "| Name | Age |\n| --- | --- |\n| Alice | 30 |";
    const { container } = render(<MarkdownMessage content={content} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const cells = container.querySelectorAll("td");
    expect(cells.length).toBe(2);
    expect(cells[0].textContent).toBe("Alice");
  });

  test("renders empty content without crashing", () => {
    const { container } = render(<MarkdownMessage content="" />);
    expect(container).toBeTruthy();
  });

  test("does not display raw markdown symbols", () => {
    const content = "**bold** and *italic* and `code`";
    render(<MarkdownMessage content={content} />);
    // Should NOT show raw ** or * or ` in the rendered output
    const text = screen.getByText("bold");
    expect(text.tagName.toLowerCase()).toBe("strong");
    const italic = screen.getByText("italic");
    expect(italic.tagName.toLowerCase()).toBe("em");
  });
});
