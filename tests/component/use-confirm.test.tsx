/**
 * Interaction tests for useConfirm hook.
 *
 * Validates:
 * - Dialog is not shown on mount
 * - openConfirm renders a dialog with the message
 * - Clicking Confirm resolves the promise with true
 * - Clicking Cancel resolves the promise with false
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "../../tests/helpers/setup-jsdom";
import { useConfirm } from "@/hooks/use-confirm";

// Minimal MUI stubs
jest.mock("@mui/material/Dialog", () => ({ __esModule: true, default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
jest.mock("@mui/material/DialogTitle", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2> }));
jest.mock("@mui/material/DialogContent", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@mui/material/DialogContentText", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <p>{children}</p> }));
jest.mock("@mui/material/DialogActions", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@mui/material/Button", () => ({ __esModule: true, default: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button> }));

function TestComponent({ onResult }: { onResult: (val: boolean) => void }) {
  const { confirmDialog, openConfirm } = useConfirm();
  return (
    <div>
      <button onClick={async () => { const result = await openConfirm("Are you sure?"); onResult(result); }}>
        Trigger
      </button>
      {confirmDialog}
    </div>
  );
}

test("dialog is not shown on mount", () => {
  const { queryByRole } = render(<TestComponent onResult={jest.fn()} />);
  expect(queryByRole("dialog")).toBeNull();
});

test("dialog appears after openConfirm is called", async () => {
  render(<TestComponent onResult={jest.fn()} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Trigger" })); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Are you sure?")).toBeInTheDocument();
});

test("clicking Confirm resolves with true", async () => {
  const onResult = jest.fn();
  render(<TestComponent onResult={onResult} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Trigger" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
});

test("clicking Cancel resolves with false", async () => {
  const onResult = jest.fn();
  render(<TestComponent onResult={onResult} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Trigger" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
});
