"use client";

import * as React from "react";
import OutlinedInput from "@mui/material/OutlinedInput";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <OutlinedInput
        inputRef={ref}
        className={className}
        type={type}
        size="small"
        fullWidth
        {...(props as any)}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
