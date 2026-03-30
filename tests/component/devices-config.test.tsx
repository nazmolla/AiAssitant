/**
 * Interaction tests for DevicesConfig component.
 *
 * Tests: render device list, register form, copy-key modal, revoke flow.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

const existingDevice = {
  id: "d1",
  name: "Desk ESP32",
  key_prefix: "nxk_abc1",
  scopes: '["device"]',
  last_used_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(devices = [existingDevice]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/devices")) {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              ...existingDevice,
              id: "d2",
              name: "New Device",
              rawKey: "nxk_testrawkey123456789012345678901",
            }),
        });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(devices) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("DevicesConfig — interactions", () => {
  test("renders device list on mount", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Desk ESP32")).toBeInTheDocument();
    });
  });

  test("shows empty state when no devices", async () => {
    setupFetch([]);
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => {
      expect(screen.getByText(/No devices registered yet/i)).toBeInTheDocument();
    });
  });

  test("Register button calls POST with device name", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => expect(screen.getByPlaceholderText(/Device name/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Device name/i), {
      target: { value: "New Device" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Register/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/devices",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "New Device" }),
      })
    );
  });

  test("displays revealed key after registration", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => expect(screen.getByPlaceholderText(/Device name/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Device name/i), {
      target: { value: "New Device" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Register/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Copy this key now/i)).toBeInTheDocument();
      expect(screen.getByText("nxk_testrawkey123456789012345678901")).toBeInTheDocument();
    });
  });

  test("Revoke button asks for confirmation before deleting", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => expect(screen.getByText("Desk ESP32")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Revoke/i }));
    });

    expect(screen.getByRole("button", { name: /Confirm Revoke/i })).toBeInTheDocument();
  });

  test("Confirm Revoke calls DELETE with device id", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => expect(screen.getByText("Desk ESP32")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Revoke/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm Revoke/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/devices/${existingDevice.id}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("Register button is disabled when name is empty", async () => {
    setupFetch();
    const { DevicesConfig } = await import("@/components/devices-config");
    await act(async () => { render(<DevicesConfig />); });
    await waitFor(() => expect(screen.getByPlaceholderText(/Device name/i)).toBeInTheDocument());

    const button = screen.getByRole("button", { name: /Register/i });
    expect(button).toBeDisabled();
  });
});
