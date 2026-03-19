/**
 * Unit tests — ChatPanel component split (PERF-12)
 *
 * Since ChatPanel (and its subcomponents which render react-markdown via
 * MarkdownMessage) can't be directly rendered in jest/jsdom (react-markdown
 * is ESM-only), we verify:
 *  1. The source code is properly split into subcomponents
 *  2. Each subcomponent is React.memo'd for render isolation
 *  3. Shared state is correctly passed via props
 *  4. Type definitions are shared via chat-panel-types.ts
 */

import fs from "fs";
import path from "path";

const componentsDir = path.join(__dirname, "../../../src/components");

const chatPanelSrc = fs.readFileSync(path.join(componentsDir, "chat-panel.tsx"), "utf-8");
const threadSidebarSrc = fs.readFileSync(path.join(componentsDir, "thread-sidebar.tsx"), "utf-8");
const chatAreaSrc = fs.readFileSync(path.join(componentsDir, "chat-area.tsx"), "utf-8");
const inputBarSrc = fs.readFileSync(path.join(componentsDir, "input-bar.tsx"), "utf-8");
const typesSrc = fs.readFileSync(path.join(componentsDir, "chat-panel-types.ts"), "utf-8");

describe("Component split structure", () => {
  test("subcomponent files exist and export named components", () => {
    expect(threadSidebarSrc).toContain("export const ThreadSidebar");
    expect(chatAreaSrc).toContain("export const ChatArea");
    expect(inputBarSrc).toContain("export const InputBar");
  });

  test("ChatPanel imports and composes all three subcomponents", () => {
    expect(chatPanelSrc).toContain('import { ThreadSidebar } from "./thread-sidebar"');
    expect(chatPanelSrc).toContain('import { ChatArea } from "./chat-area"');
    expect(chatPanelSrc).toContain('import { InputBar } from "./input-bar"');

    // JSX usage
    expect(chatPanelSrc).toContain("<ThreadSidebar");
    expect(chatPanelSrc).toContain("<ChatArea");
    expect(chatPanelSrc).toContain("<InputBar");
  });

  test("subcomponents are wrapped with React.memo for render isolation", () => {
    expect(threadSidebarSrc).toMatch(/memo\(function ThreadSidebar/);
    expect(chatAreaSrc).toMatch(/memo\(function ChatArea/);
    expect(inputBarSrc).toMatch(/memo\(function InputBar/);
  });

  test("ChatPanel no longer contains inline JSX for sidebar, messages, or input", () => {
    // Should not have the old inline thread list rendering
    expect(chatPanelSrc).not.toContain("<ListItemButton");
    expect(chatPanelSrc).not.toContain("<DeleteOutlineIcon");
    // Should not have the old inline message rendering (JSX tags — comments referencing them are OK)
    expect(chatPanelSrc).not.toContain("<ThinkingBlock");
    expect(chatPanelSrc).not.toContain("<ThoughtsBlock");
    expect(chatPanelSrc).not.toContain("<AttachmentPreview");
    // Should not have the old inline input rendering
    expect(chatPanelSrc).not.toContain("<TextField");
    expect(chatPanelSrc).not.toContain("<SendIcon");
  });
});

describe("Shared types module", () => {
  test("chat-panel-types.ts exports all shared interfaces", () => {
    expect(typesSrc).toContain("export interface Thread");
    expect(typesSrc).toContain("export interface AttachmentMeta");
    expect(typesSrc).toContain("export interface Message");
    expect(typesSrc).toContain("export interface PendingFile");
    expect(typesSrc).toContain("export interface ThinkingStep");
    expect(typesSrc).toContain("export interface ThoughtStep");
    expect(typesSrc).toContain("export interface ProcessedMessage");
  });

  test("chat-panel-types.ts exports shared utility functions", () => {
    expect(typesSrc).toContain("export function sanitizeToolContent");
    expect(typesSrc).toContain("export function extractApprovalMeta");
    expect(typesSrc).toContain("export function stripApprovalMeta");
    expect(typesSrc).toContain("export function safeJsonParse");
    expect(typesSrc).toContain("export function sanitizeAssistantContent");
    expect(typesSrc).toContain("export const ACCEPT_STRING");
  });

  test("all subcomponents import types from the shared module", () => {
    expect(threadSidebarSrc).toContain('from "./chat-panel-types"');
    expect(chatAreaSrc).toContain('from "./chat-panel-types"');
    expect(inputBarSrc).toContain('from "./chat-panel-types"');
    expect(chatPanelSrc).toContain('from "./chat-panel-types"');
  });
});

describe("ThreadSidebar component", () => {
  test("declares a props interface with all required props", () => {
    expect(threadSidebarSrc).toContain("export interface ThreadSidebarProps");
    const requiredProps = [
      "threads", "threadsTotal", "threadsHasMore", "activeThread",
      "showSidebar", "onSelectThread", "onCreateThread", "onDeleteThread", "onLoadMore",
    ];
    for (const prop of requiredProps) {
      expect(threadSidebarSrc).toContain(prop);
    }
  });

  test("renders thread list with status chips and delete buttons", () => {
    expect(threadSidebarSrc).toContain("thread.title");
    expect(threadSidebarSrc).toContain("thread.status");
    expect(threadSidebarSrc).toContain("onDeleteThread");
    expect(threadSidebarSrc).toContain("DeleteOutlineIcon");
  });

  test("supports load more pagination", () => {
    expect(threadSidebarSrc).toContain("threadsHasMore");
    expect(threadSidebarSrc).toContain("onLoadMore");
    expect(threadSidebarSrc).toContain("Load more");
  });
});

describe("ChatArea component", () => {
  test("declares a props interface with all required props", () => {
    expect(chatAreaSrc).toContain("export interface ChatAreaProps");
    const requiredProps = [
      "processedMessages", "loading", "thinkingSteps", "activeThread",
      "activeThreadTitle", "showSidebar", "onToggleSidebar",
      "playingTtsId", "onPlayTts", "actingApproval", "resolvedApprovals", "onApproval",
    ];
    for (const prop of requiredProps) {
      expect(chatAreaSrc).toContain(prop);
    }
  });

  test("contains ThinkingBlock and ThoughtsBlock subcomponents", () => {
    expect(chatAreaSrc).toMatch(/memo\(function ThinkingBlock/);
    expect(chatAreaSrc).toMatch(/memo\(function ThoughtsBlock/);
    expect(chatAreaSrc).toMatch(/memo\(function AttachmentPreview/);
  });

  test("shows Gemini-style welcome state when no active thread", () => {
    expect(chatAreaSrc).toContain("Where should we start?");
    expect(chatAreaSrc).toContain("AutoFixHighIcon");
  });

  test("uses virtualized rendering with auto-scroll", () => {
    expect(chatAreaSrc).toContain("useVirtualizer");
    expect(chatAreaSrc).toContain("scrollToIndex");
    expect(chatAreaSrc).toContain("getVirtualItems");
  });
});

describe("InputBar component", () => {
  test("declares a props interface with all required props", () => {
    expect(inputBarSrc).toContain("export interface InputBarProps");
    const requiredProps = [
      "input", "onInputChange", "onSendMessage", "loading", "activeThread",
      "pendingFiles", "onFileSelect", "onRemovePendingFile", "fileInputRef",
      "recording", "transcribing", "onStartRecording", "onStopRecording",
      "screenShareEnabled", "screenSharing", "onStartScreenShare", "onStopScreenShare",
      "audioMode", "audioModeSpeaking", "onToggleAudioMode",
    ];
    for (const prop of requiredProps) {
      expect(inputBarSrc).toContain(prop);
    }
  });

  test("renders text input, send button, and media controls", () => {
    expect(inputBarSrc).toContain("<TextField");
    expect(inputBarSrc).toContain("SendIcon");
    expect(inputBarSrc).toContain("AttachFileIcon");
    expect(inputBarSrc).toContain("MicIcon");
    expect(inputBarSrc).toContain("ScreenShareIcon");
  });

  test("shows screen sharing and audio mode indicators", () => {
    expect(inputBarSrc).toContain("Sharing your screen");
    expect(inputBarSrc).toContain("Audio mode active");
  });

  test("supports pending file previews with deletion", () => {
    expect(inputBarSrc).toContain("pendingFiles.map");
    expect(inputBarSrc).toContain("onRemovePendingFile");
  });
});

describe("State isolation", () => {
  test("ChatPanel owns core UI state and delegates domain state to hooks", () => {
    // ChatPanel retains thread list state and UI state
    expect(chatPanelSrc).toContain("useState<Thread[]>");
    expect(chatPanelSrc).toContain('useState("")'); // input
    expect(chatPanelSrc).toContain("useState(false)"); // showSidebar (hidden by default)
    // Message[] and PendingFile[] state are now in extracted hooks
    expect(chatPanelSrc).toContain("useChatStream");
    expect(chatPanelSrc).toContain("useFileUpload");
    expect(chatPanelSrc).toContain("useScreenShare");
    expect(chatPanelSrc).toContain("useAudioControls");
  });

  test("ThreadSidebar does not manage its own fetch state", () => {
    expect(threadSidebarSrc).not.toContain("useState");
    expect(threadSidebarSrc).not.toContain("useEffect");
    expect(threadSidebarSrc).not.toContain("fetch(");
  });

  test("InputBar does not manage its own message state", () => {
    expect(inputBarSrc).not.toContain("useState");
    expect(inputBarSrc).not.toContain("useEffect");
    expect(inputBarSrc).not.toContain("fetch(");
  });

  test("ChatArea manages its own virtualizer and scroll state", () => {
    expect(chatAreaSrc).toContain("useVirtualizer");
    expect(chatAreaSrc).toContain("scrollContainerRef");
    // ChatArea should NOT have primary state for messages, threads, or input
    const stateMatches = [...chatAreaSrc.matchAll(/\buseState\b/g)];
    // Only ThinkingBlock and ThoughtsBlock have local expanded state
    // (2 components x 1 useState each = at most a few)
    expect(stateMatches.length).toBeLessThanOrEqual(4);
  });
});

describe("Reduced file sizes", () => {
  test("ChatPanel is significantly smaller after split", () => {
    // ChatPanel was 1756 lines, should now be under 1100
    const lineCount = chatPanelSrc.split("\n").length;
    expect(lineCount).toBeLessThan(1100);
  });

  test("each subcomponent is a reasonable size", () => {
    expect(threadSidebarSrc.split("\n").length).toBeLessThan(250); // includes MUI Drawer
    expect(inputBarSrc.split("\n").length).toBeLessThan(300); // welcomeMode variant adds lines
    // ChatArea is the largest since it includes ThinkingBlock, ThoughtsBlock, AttachmentPreview
    // Keep a soft ceiling while allowing room for welcome state + virtualization stability guards.
    expect(chatAreaSrc.split("\n").length).toBeLessThan(800);
  });
});
