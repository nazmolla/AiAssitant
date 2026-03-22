/**
 * Interaction tests for useToast hook.
 *
 * Validates:
 * - Snackbar is not shown on mount
 * - showToast renders a Snackbar with the message
 * - showToast defaults to "error" severity
 * - showToast supports custom severity
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import "../../tests/helpers/setup-jsdom";
import { useToast } from "@/hooks/use-toast";

// Minimal MUI stubs
jest.mock("@mui/material/Snackbar", () => ({
  __esModule: true,
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="snackbar">{children}</div> : null,
}));
jest.mock("@mui/material/Alert", () => ({
  __esModule: true,
  default: ({ children, severity }: { children: React.ReactNode; severity: string }) => (
    <div data-testid="alert" data-severity={severity}>{children}</div>
  ),
}));

function TestComponent({ onMount }: { onMount: (fn: (msg: string, sev?: "error" | "warning" | "info" | "success") => void) => void }) {
  const { toastSnackbar, showToast } = useToast();
  React.useEffect(() => { onMount(showToast); }, [onMount, showToast]);
  return <>{toastSnackbar}</>;
}

test("snackbar is not shown on mount", () => {
  render(<TestComponent onMount={jest.fn()} />);
  expect(screen.queryByTestId("snackbar")).toBeNull();
});

test("showToast renders snackbar with the message", async () => {
  let showFn!: (msg: string) => void;
  render(<TestComponent onMount={(fn) => { showFn = fn; }} />);

  await act(async () => { showFn("Something went wrong"); });

  expect(screen.getByTestId("snackbar")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong")).toBeInTheDocument();
});

test("showToast defaults to error severity", async () => {
  let showFn!: (msg: string) => void;
  render(<TestComponent onMount={(fn) => { showFn = fn; }} />);

  await act(async () => { showFn("Error message"); });

  expect(screen.getByTestId("alert")).toHaveAttribute("data-severity", "error");
});

test("showToast supports success severity", async () => {
  let showFn!: (msg: string, sev?: "error" | "warning" | "info" | "success") => void;
  render(<TestComponent onMount={(fn) => { showFn = fn; }} />);

  await act(async () => { showFn("Done!", "success"); });

  expect(screen.getByTestId("alert")).toHaveAttribute("data-severity", "success");
});
