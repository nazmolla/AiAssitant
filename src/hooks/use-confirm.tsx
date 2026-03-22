"use client";
/**
 * useConfirm — replaces window.confirm() with a non-blocking MUI Dialog.
 *
 * Usage:
 *   const { confirmDialog, openConfirm } = useConfirm();
 *   const ok = await openConfirm("Are you sure?");
 *   if (!ok) return;
 *   // ... proceed
 *   return <>{confirmDialog}</>;
 */
import { useState, useCallback, useRef } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const openConfirm = useCallback((msg: string): Promise<boolean> => {
    setMessage(msg);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleClose = useCallback((confirmed: boolean) => {
    setOpen(false);
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
  }, []);

  const confirmDialog = (
    <Dialog open={open} onClose={() => handleClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Confirm</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => handleClose(false)}>Cancel</Button>
        <Button onClick={() => handleClose(true)} color="error" variant="contained" autoFocus>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { confirmDialog, openConfirm };
}
