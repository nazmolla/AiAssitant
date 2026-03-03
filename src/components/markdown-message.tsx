"use client";

import React, { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * MarkdownMessage — renders assistant messages as rich formatted HTML.
 *
 * Uses react-markdown + remark-gfm for GitHub-Flavoured Markdown:
 * headings, bold, italic, lists, tables, horizontal rules, code blocks,
 * task lists, strikethrough, etc.
 *
 * Custom MUI-compatible styling for dark-theme chat bubbles.
 */

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0.7em 0 0.3em", lineHeight: 1.3 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0.6em 0 0.25em", lineHeight: 1.3 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: "0.5em 0 0.2em", lineHeight: 1.3 }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0.4em 0 0.15em", lineHeight: 1.35 }}>
      {children}
    </h4>
  ),

  // Paragraphs
  p: ({ children }) => (
    <p style={{ margin: "0.4em 0", lineHeight: 1.65, fontSize: "0.875rem" }}>
      {children}
    </p>
  ),

  // Bold / strong
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600, color: "inherit" }}>{children}</strong>
  ),

  // Emphasis / italic
  em: ({ children }) => (
    <em style={{ fontStyle: "italic" }}>{children}</em>
  ),

  // Horizontal rule
  hr: () => (
    <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "0.8em 0" }} />
  ),

  // Unordered list
  ul: ({ children }) => (
    <ul style={{ margin: "0.3em 0", paddingLeft: "1.5em", listStyleType: "disc" }}>
      {children}
    </ul>
  ),

  // Ordered list
  ol: ({ children }) => (
    <ol style={{ margin: "0.3em 0", paddingLeft: "1.5em", listStyleType: "decimal" }}>
      {children}
    </ol>
  ),

  // List item
  li: ({ children }) => (
    <li style={{ margin: "0.15em 0", lineHeight: 1.55, fontSize: "0.875rem" }}>
      {children}
    </li>
  ),

  // Inline code
  code: ({ children, className }) => {
    // If className contains "language-*", it's a fenced code block inner element
    const isBlock = className && className.startsWith("language-");
    if (isBlock) {
      return (
        <code
          style={{
            display: "block",
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            fontSize: "0.8rem",
            lineHeight: 1.5,
          }}
        >
          {children}
        </code>
      );
    }
    // Inline code
    return (
      <code
        style={{
          backgroundColor: "rgba(255,255,255,0.08)",
          padding: "0.15em 0.4em",
          borderRadius: 4,
          fontSize: "0.82em",
          fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
        }}
      >
        {children}
      </code>
    );
  },

  // Fenced code block (```...```)
  pre: ({ children }) => (
    <pre
      style={{
        backgroundColor: "rgba(0,0,0,0.35)",
        borderRadius: 6,
        padding: "0.7em 1em",
        margin: "0.5em 0",
        overflowX: "auto",
        fontSize: "0.8rem",
        lineHeight: 1.5,
      }}
    >
      {children}
    </pre>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid rgba(255,255,255,0.25)",
        margin: "0.5em 0",
        paddingLeft: "0.8em",
        color: "rgba(255,255,255,0.7)",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "#60a5fa",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </a>
  ),

  // Tables (GFM)
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.5em 0" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: "0.82rem",
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ borderBottom: "2px solid rgba(255,255,255,0.15)" }}>
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th
      style={{
        textAlign: "left",
        padding: "0.4em 0.6em",
        fontWeight: 600,
        fontSize: "0.8rem",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: "0.35em 0.6em", fontSize: "0.82rem" }}>
      {children}
    </td>
  ),

  // Task list items (GFM)
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      style={{ marginRight: "0.4em", verticalAlign: "middle" }}
    />
  ),
};

interface MarkdownMessageProps {
  content: string;
}

const MarkdownMessage = memo(function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="markdown-message" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownMessage;
