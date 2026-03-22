/**
 * Interaction tests for CustomToolsConfig.
 *
 * Tests: toggle enable (PUT), delete tool (DELETE + confirm), expand tool details,
 * empty state.
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

let mockOpenConfirm: jest.Mock = jest.fn();
jest.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => ({ confirmDialog: null, openConfirm: mockOpenConfirm }),
}));

const mockTool = {
  name: "weather_check",
  description: "Checks current weather for a city",
  input_schema: '{"type":"object","properties":{"city":{"type":"string","description":"City name"}}}',
  implementation: 'return { temp: 22 };',
  enabled: 1,
  created_at: "2025-01-01T00:00:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(tools = [mockTool]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/custom-tools")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(tools) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

beforeEach(() => {
  mockOpenConfirm = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

describe("CustomToolsConfig — interactions", () => {
  test("renders tool name and description", async () => {
    setupFetch();
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("weather_check")).toBeInTheDocument();
    });
    expect(screen.getByText(/checks current weather/i)).toBeInTheDocument();
  });

  test("toggling switch calls PUT with name and enabled state", async () => {
    setupFetch();
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<CustomToolsConfig />)); });
    await waitFor(() => {
      expect(screen.getByText("weather_check")).toBeInTheDocument();
    });

    // MUI Switch hides its checkbox input; find it via DOM query
    const switchInput = container!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(switchInput).toBeTruthy();
    await act(async () => {
      fireEvent.click(switchInput);
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/custom-tools") && o?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body as string);
    expect(body.name).toBe("weather_check");
    expect(body.enabled).toBe(false); // toggled from 1 to false
  });

  test("Delete button calls DELETE after window.confirm", async () => {
    setupFetch();
    mockOpenConfirm.mockResolvedValue(true);
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("weather_check")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    });

    expect(mockOpenConfirm).toHaveBeenCalled();

    await waitFor(() => {
      const delCalls = fetchMock.mock.calls.filter(
        ([u, o]: [string, RequestInit?]) => u.includes("/api/config/custom-tools") && o?.method === "DELETE"
      );
      expect(delCalls.length).toBe(1);
      expect(JSON.parse(delCalls[0][1].body as string).name).toBe("weather_check");
    });
  });

  test("Delete button does NOT call DELETE when confirm is cancelled", async () => {
    setupFetch();
    mockOpenConfirm.mockResolvedValue(false);
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("weather_check")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    });

    await new Promise((r) => setTimeout(r, 50));
    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/custom-tools") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("clicking tool name expands details showing implementation", async () => {
    setupFetch();
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("weather_check")).toBeInTheDocument();
    });

    // Click the tool name area to expand
    await act(async () => {
      fireEvent.click(screen.getByText("weather_check"));
    });

    expect(screen.getByText("Implementation")).toBeInTheDocument();
    expect(screen.getByText("return { temp: 22 };")).toBeInTheDocument();
  });

  test("empty state shows 'No custom tools created yet'", async () => {
    setupFetch([]);
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText(/no custom tools created yet/i)).toBeInTheDocument();
    });
  });

  test("shows 'Active' badge for enabled tools", async () => {
    setupFetch();
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    await act(async () => { render(<CustomToolsConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument();
    });
  });
});
