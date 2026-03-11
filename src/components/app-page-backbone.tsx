"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";

interface AppPageBackboneProps {
  children: ReactNode;
  maxWidth?: number;
}

export function AppPageBackbone({ children, maxWidth = 1500 }: AppPageBackboneProps) {
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ maxWidth, mx: "auto", width: "100%" }}>{children}</Box>
    </Box>
  );
}
