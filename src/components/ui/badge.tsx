import * as React from "react";
import { cn } from "@/lib/utils";

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variantClasses = {
    default: "bg-primary/15 text-primary dark:bg-primary/20",
    secondary: "bg-secondary text-secondary-foreground",
    destructive: "bg-red-500/10 text-red-600 dark:text-red-400",
    outline: "text-muted-foreground border border-border/80",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
    warning: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  };

  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-lg border border-transparent px-2.5 py-0.5 text-[11px] font-medium transition-all duration-200 backdrop-blur-sm",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = "Badge";

export { Badge };
