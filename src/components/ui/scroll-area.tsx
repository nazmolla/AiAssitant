"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <Box
    ref={ref}
    className={cn("overflow-auto", className)}
    {...props}
  >
    {children}
  </Box>
));
ScrollArea.displayName = "ScrollArea";

const ScrollBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (_props, _ref) => null
);
ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
