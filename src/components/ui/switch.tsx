"use client";

import * as React from "react";
import MuiSwitch from "@mui/material/Switch";

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, ...rest }, ref) => {
    return (
      <MuiSwitch
        ref={ref as any}
        className={className}
        checked={checked}
        onChange={(_, c) => onCheckedChange?.(c)}
        size="small"
        {...(rest as any)}
      />
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
