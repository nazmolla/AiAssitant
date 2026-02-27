"use client";

import * as React from "react";
import Chip from "@mui/material/Chip";

const VARIANT_MAP: Record<string, { color: "primary" | "secondary" | "error" | "success" | "warning" | "default" | "info"; variant: "filled" | "outlined" }> = {
  default: { color: "primary", variant: "filled" },
  secondary: { color: "default", variant: "filled" },
  destructive: { color: "error", variant: "filled" },
  outline: { color: "default", variant: "outlined" },
  success: { color: "success", variant: "filled" },
  warning: { color: "warning", variant: "filled" },
};

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
  }
>(({ className, variant = "default", children, ...props }, ref) => {
  const mapped = VARIANT_MAP[variant] ?? VARIANT_MAP.default;
  return (
    <Chip
      ref={ref as any}
      className={className}
      label={children}
      size="small"
      color={mapped.color}
      variant={mapped.variant}
      {...(props as any)}
    />
  );
});
Badge.displayName = "Badge";

export { Badge };
