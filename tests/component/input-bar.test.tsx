/**
 * Component interaction tests for InputBar.
 *
 * InputBar is a pure presentational component â€” all state and callbacks are
 * prop-driven. Tests verify that user interactions call the correct callback
 * with the correct arguments and that the correct disabled/enabled states are
 * applied based on props.
 *
 * @jest-environment jsdom
 */
import React, { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "user@test.com", id: "u1", role: "user" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

// MUI icon stubs â€” keep tests fast
jest.mock("@mui/icons-material/Send", () => () => <span data-testid="SendIcon" />);
jest.mock("@mui/icons-material/AttachFile", () => () => <span data-testid="AttachFileIcon" />);
jest.mock("@mui/icons-material/ScreenShare", () => () => <span data-testid="ScreenShareIcon" />);
jest.mock("@mui/icons-material/StopScreenShare", () => () => <span data-testid="StopScreenShareIcon" />);
jest.mock("@mui/icons-material/Mic", () => () => <span data-testid="MicIcon" />);
jest.mock("@mui/icons-material/MicOff", () => () => <span data-testid="MicOffIcon" />);
// MUI Chip uses CancelIcon internally for the delete button
jest.mock("@mui/icons-material/Cancel", () => () => <span data-testid="CancelIcon" />);

import { InputBar, type InputBarProps } from "@/components/input-bar";
import type { PendingFile } from "@/components/chat-panel-types";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeFile(name: string): PendingFile {
  const f = new File(["content"], name, { type: "text/plain" });
  return { file: f, previewUrl: null, uploading: false };
}

function baseProps(overrides: Partial<InputBarProps> = {}): InputBarProps {
  return {
    input: "",
    onInputChange: jest.fn(),
    onSendMessage: jest.fn(),
    loading: false,
    activeThread: "thread-1",
    pendingFiles: [],
    onFileSelect: jest.fn(),
    onRemovePendingFile: jest.fn(),
    fileInputRef: createRef(),
    recording: false,
    transcribing: false,
    onStartRecording: jest.fn(),
    onStopRecording: jest.fn(),
    screenShareEnabled: false,
    screenSharing: false,
    onStartScreenShare: jest.fn(),
    onStopScreenShare: jest.fn(),
    audioMode: false,
    audioModeSpeaking: false,
    onToggleAudioMode: jest.fn(),
    latestFrameRef: { current: null },
    frameImgRef: createRef(),
    ...overrides,
  };
}

function renderBar(overrides: Partial<InputBarProps> = {}) {
  const props = baseProps(overrides);
  render(<InputBar {...props} />);
  return props;
}

function getSendButton() {
  return screen.getByTitle("Send message");
}

function getTextField() {
  return screen.getByPlaceholderText("Message Nexus...");
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. SEND BUTTON DISABLED / ENABLED STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” send button disabled/enabled state", () => {
  test("send button is disabled when input is empty and no files", () => {
    renderBar({ input: "", pendingFiles: [] });
    expect(getSendButton()).toBeDisabled();
  });

  test("send button is enabled when input has text", () => {
    renderBar({ input: "Hello Nexus" });
    expect(getSendButton()).not.toBeDisabled();
  });

  test("send button is enabled when input is whitespace-only â€” (only spaces, disabled)", () => {
    renderBar({ input: "   " });
    expect(getSendButton()).toBeDisabled();
  });

  test("send button is enabled when there are pending files even with empty input", () => {
    renderBar({ input: "", pendingFiles: [makeFile("doc.pdf")] });
    expect(getSendButton()).not.toBeDisabled();
  });

  test("send button is disabled when loading is true", () => {
    renderBar({ input: "Hello", loading: true });
    expect(getSendButton()).toBeDisabled();
  });

  test("attach button is disabled when loading is true", () => {
    renderBar({ loading: true });
    expect(screen.getByTitle("Attach files")).toBeDisabled();
  });

  test("attach button is disabled when there is no active thread", () => {
    renderBar({ activeThread: null });
    expect(screen.getByTitle("Attach files")).toBeDisabled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. SEND BUTTON CLICK
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” send button click", () => {
  test("clicking send button calls onSendMessage", () => {
    const props = renderBar({ input: "Hello" });
    fireEvent.click(getSendButton());
    expect(props.onSendMessage).toHaveBeenCalledTimes(1);
  });

  test("clicking disabled send button does NOT call onSendMessage", () => {
    const props = renderBar({ input: "" });
    fireEvent.click(getSendButton());
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. ENTER KEY BEHAVIOUR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” Enter key behaviour", () => {
  test("pressing Enter calls onSendMessage", () => {
    const props = renderBar({ input: "Hello" });
    fireEvent.keyDown(getTextField(), { key: "Enter", code: "Enter", shiftKey: false });
    expect(props.onSendMessage).toHaveBeenCalledTimes(1);
  });

  test("pressing Shift+Enter does NOT call onSendMessage", () => {
    const props = renderBar({ input: "Hello" });
    fireEvent.keyDown(getTextField(), { key: "Enter", code: "Enter", shiftKey: true });
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });

  test("pressing other keys does NOT call onSendMessage", () => {
    const props = renderBar({ input: "Hello" });
    fireEvent.keyDown(getTextField(), { key: "a" });
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 4. INPUT CHANGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” text input change", () => {
  test("typing in the text field calls onInputChange with the new value", () => {
    const props = renderBar();
    fireEvent.change(getTextField(), { target: { value: "new message" } });
    expect(props.onInputChange).toHaveBeenCalledWith("new message");
  });

  test("clearing the text field calls onInputChange with empty string", () => {
    const props = renderBar({ input: "existing" });
    fireEvent.change(getTextField(), { target: { value: "" } });
    expect(props.onInputChange).toHaveBeenCalledWith("");
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 5. PENDING FILE CHIPS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” pending file chips", () => {
  test("pending file chip appears for each attached file", () => {
    renderBar({ pendingFiles: [makeFile("report.pdf"), makeFile("image.png")] });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("image.png")).toBeInTheDocument();
  });

  test("no file chips when pendingFiles is empty", () => {
    renderBar({ pendingFiles: [] });
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
  });

  test("clicking the delete icon on a file chip (second) calls onRemovePendingFile with index 1", () => {
    const props = renderBar({
      pendingFiles: [makeFile("first.pdf"), makeFile("second.pdf")],
    });
    // MUI Chip uses CancelIcon internally; mocked to <span data-testid="CancelIcon" />
    const cancelIcons = screen.getAllByTestId("CancelIcon");
    fireEvent.click(cancelIcons[1]);
    expect(props.onRemovePendingFile).toHaveBeenCalledWith(1);
  });

  test("clicking the delete icon on a file chip (first) calls onRemovePendingFile with index 0", () => {
    const props = renderBar({
      pendingFiles: [makeFile("alpha.pdf"), makeFile("beta.pdf")],
    });
    const cancelIcons = screen.getAllByTestId("CancelIcon");
    fireEvent.click(cancelIcons[0]);
    expect(props.onRemovePendingFile).toHaveBeenCalledWith(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 6. VOICE RECORDING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” voice recording button", () => {
  test("mic button shows when not recording", () => {
    renderBar({ audioMode: false });
    expect(screen.getByTitle("Voice input")).toBeInTheDocument();
  });

  test("clicking mic button when not recording calls onStartRecording", () => {
    const props = renderBar({ recording: false, audioMode: false });
    fireEvent.click(screen.getByTitle("Voice input"));
    expect(props.onStartRecording).toHaveBeenCalledTimes(1);
  });

  test("clicking mic button when recording calls onStopRecording", () => {
    const props = renderBar({ recording: true, audioMode: false });
    fireEvent.click(screen.getByTitle("Stop recording"));
    expect(props.onStopRecording).toHaveBeenCalledTimes(1);
  });

  test("mic button is disabled when transcribing", () => {
    renderBar({ transcribing: true, audioMode: false });
    expect(screen.getByTitle("Transcribing...")).toBeDisabled();
  });

  test("mic button is not rendered when audioMode is true", () => {
    renderBar({ audioMode: true });
    expect(screen.queryByTitle("Voice input")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Stop recording")).not.toBeInTheDocument();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 7. SCREEN SHARING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe("InputBar â€” screen sharing", () => {
  test("screen share button is NOT shown when screenShareEnabled is false", () => {
    renderBar({ screenShareEnabled: false });
    expect(screen.queryByTitle("Share your screen")).not.toBeInTheDocument();
  });

  test("screen share button appears when screenShareEnabled is true", () => {
    renderBar({ screenShareEnabled: true, screenSharing: false });
    expect(screen.getByTitle("Share your screen")).toBeInTheDocument();
  });

  test("clicking start screen share calls onStartScreenShare", () => {
    const props = renderBar({ screenShareEnabled: true, screenSharing: false });
    fireEvent.click(screen.getByTitle("Share your screen"));
    expect(props.onStartScreenShare).toHaveBeenCalledTimes(1);
  });

  test("clicking stop screen share calls onStopScreenShare", () => {
    const props = renderBar({ screenShareEnabled: true, screenSharing: true });
    fireEvent.click(screen.getByTitle("Stop screen sharing"));
    expect(props.onStopScreenShare).toHaveBeenCalledTimes(1);
  });

  test("screen sharing indicator banner is shown when screenSharing is true", () => {
    renderBar({ screenShareEnabled: true, screenSharing: true });
    expect(screen.getByText("Sharing your screen")).toBeInTheDocument();
  });
});
