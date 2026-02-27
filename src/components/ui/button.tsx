"use client";

import * as React from "react";
import MuiButton from "@mui/material/Button";
import MuiIconButton from "@mui/material/IconButton";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "default", asChild, className, children, ...rest }, ref) => {
    if (size === "icon") {
      return (
        <MuiIconButton
          ref={ref}
          className={className}
          size="small"
          color={variant === "destructive" ? "error" : "primary"}
          {...(rest as any)}
        >
          {children}
        </MuiIconButton>
      );
    }

    const muiVariant =
      variant === "outline"
        ? ("outlined" as const)
        : variant === "ghost" || variant === "link"
          ? ("text" as const)
          : ("contained" as const);

    const muiColor =
      variant === "destructive"
        ? ("error" as const)
        : variant === "secondary"
          ? ("secondary" as const)
          : variant === "ghost" || variant === "outline"
            ? ("inherit" as const)
            : ("primary" as const);

    const muiSize =
      size === "sm" ? ("small" as const) : size === "lg" ? ("large" as const) : ("medium" as const);

    return (
      <MuiButton
        ref={ref}
        className={className}
        variant={muiVariant}
        color={muiColor}
        size={muiSize}
        {...(rest as any)}
      >
        {children}
      </MuiButton>
    );
  }
);
Button.displayName = "Button";

const buttonVariants = () => "";

export { Button, buttonVariants };
