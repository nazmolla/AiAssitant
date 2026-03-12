/**
 * Interaction tests for ChannelsConfig.
 *
 * Tests: add channel (POST), toggle enable/disable (PATCH), delete channel (DELETE + confirm),
 * form validation, empty state, copy webhook URL.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "admin@test.com", id: "admin-1", role: "admin" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ formatDate: (s: string) => s }),
}));

const mockChannel = {
  id: "ch-1",
  channel_type: "telegram",
  label: "Support Bot",
  enabled: 1,
  config_json: '{"botToken":"***","botUsername":"nexus_bot"}',
  webhook_secret: "sec123",
  created_at: "2025-01-01T00:00:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(channels = [mockChannel]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/config/channels")) {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "ch-new" }) });
      }
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(channels) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("ChannelsConfig — interactions", () => {
  test("renders existing channel with label, type badge, and active status", async () => {
    setupFetch();
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Support Bot").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("Telegram").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
  });

  test("'+ Connect Channel' button reveals channel type selector", async () => {
    setupFetch([]);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No channels connected")).toBeInTheDocument();
    });

    const connectBtn = screen.getByRole("button", { name: /connect channel/i });
    await act(async () => { fireEvent.click(connectBtn); });

    expect(screen.getByText("Connect a Channel")).toBeInTheDocument();
    // Channel type options appear — use getAllByText since label + description contain same words
    expect(screen.getAllByText(/WhatsApp/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Slack/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Telegram/).length).toBeGreaterThanOrEqual(1);
  });

  test("selecting channel type shows config form, then submitting calls POST", async () => {
    setupFetch([]);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No channels connected")).toBeInTheDocument();
    });

    // Open form
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /connect channel/i })); });

    // Select Telegram — use the first match (the button label, not description)
    const telegramMatches = screen.getAllByText(/Telegram/);
    await act(async () => { fireEvent.click(telegramMatches[0]); });

    // Should show config fields
    expect(screen.getByPlaceholderText("Bot Token")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Bot Username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g., My WhatsApp Bot")).toBeInTheDocument();

    // Fill fields
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("e.g., My WhatsApp Bot"), { target: { value: "My Telegram Bot" } });
      fireEvent.change(screen.getByPlaceholderText("Bot Token"), { target: { value: "123456:ABCdef" } });
      fireEvent.change(screen.getByPlaceholderText("Bot Username"), { target: { value: "test_bot" } });
    });

    // Submit
    const connectChannelBtn = screen.getByRole("button", { name: /connect channel/i });
    await act(async () => { fireEvent.click(connectChannelBtn); });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/channels") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body.label).toBe("My Telegram Bot");
    expect(body.channelType).toBe("telegram");
    expect(body.config.botToken).toBe("123456:ABCdef");
    expect(body.config.botUsername).toBe("test_bot");
  });

  test("toggle switch calls PATCH with enabled toggled", async () => {
    setupFetch();
    const { ChannelsConfig } = await import("@/components/channels-config");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<ChannelsConfig />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Support Bot").length).toBeGreaterThanOrEqual(1);
    });

    // Find MUI Switch checkbox
    const switches = container!.querySelectorAll('input[type="checkbox"]');
    expect(switches.length).toBeGreaterThanOrEqual(1);

    await act(async () => { fireEvent.click(switches[0]); });

    const patchCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/channels") && o?.method === "PATCH"
    );
    expect(patchCalls.length).toBe(1);
    const body = JSON.parse(patchCalls[0][1].body as string);
    expect(body.id).toBe("ch-1");
    expect(body.enabled).toBe(false); // toggled from 1 (truthy)
  });

  test("delete button calls DELETE after window.confirm", async () => {
    setupFetch();
    window.confirm = jest.fn(() => true);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Support Bot").length).toBeGreaterThanOrEqual(1);
    });

    const deleteBtns = screen.getAllByRole("button", { name: /✕/i });
    expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
    await act(async () => { fireEvent.click(deleteBtns[0]); });

    expect(window.confirm).toHaveBeenCalled();
    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/channels") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    expect(delCalls[0][0]).toContain("id=ch-1");
  });

  test("delete button does NOT call DELETE when confirm is cancelled", async () => {
    setupFetch();
    window.confirm = jest.fn(() => false);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Support Bot").length).toBeGreaterThanOrEqual(1);
    });

    const deleteBtns = screen.getAllByRole("button", { name: /✕/i });
    await act(async () => { fireEvent.click(deleteBtns[0]); });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/channels") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("connect button is disabled when label is empty", async () => {
    setupFetch([]);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No channels connected")).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /connect channel/i })); });
    const telegramBtns = screen.getAllByText(/Telegram/);
    await act(async () => { fireEvent.click(telegramBtns[0]); });

    // Connect Channel submit button should be disabled when label is empty
    const submitBtns = screen.getAllByRole("button", { name: /connect channel/i });
    const submitBtn = submitBtns[submitBtns.length - 1]; // the submit button, not cancel
    expect(submitBtn).toBeDisabled();
  });

  test("empty state shows when no channels exist", async () => {
    setupFetch([]);
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No channels connected")).toBeInTheDocument();
    });
  });

  test("copy webhook URL button copies to clipboard", async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    setupFetch();
    const { ChannelsConfig } = await import("@/components/channels-config");
    await act(async () => { render(<ChannelsConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Support Bot").length).toBeGreaterThanOrEqual(1);
    });

    const copyBtns = screen.getAllByRole("button", { name: /copy url/i });
    expect(copyBtns.length).toBeGreaterThanOrEqual(1);

    await act(async () => { fireEvent.click(copyBtns[0]); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/api/channels/ch-1/webhook"));
  });
});
