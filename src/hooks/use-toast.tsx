"use client";
/**
 * useToast — replaces window.alert() with a non-blocking MUI Snackbar.
 *
 * Usage:
 *   const { toastSnackbar, showToast } = useToast();
 *   showToast("Something went wrong", "error");
 *   return <>{toastSnackbar}</>;
 */
import { useState, useCallback } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";

type ToastSeverity = "error" | "warning" | "info" | "success";

export function useToast() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<ToastSeverity>("error");

  const showToast = useCallback((msg: string, sev: ToastSeverity = "error") => {
    setMessage(msg);
    setSeverity(sev);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  const toastSnackbar = (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={handleClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert onClose={handleClose} severity={severity} variant="filled" sx={{ width: "100%" }}>
        {message}
      </Alert>
    </Snackbar>
  );

  return { toastSnackbar, showToast };
}
