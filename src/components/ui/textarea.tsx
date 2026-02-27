"use client";

import * as React from "react";
import OutlinedInput from "@mui/material/OutlinedInput";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <OutlinedInput
        inputRef={ref}
        className={className}
        multiline
        minRows={3}
        fullWidth
        size="small"
        {...(props as any)}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
