"use client";

import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 768; // md breakpoint

/**
 * JS-based responsive hook. Returns `true` when viewport width < 768px.
 * Uses `matchMedia` for efficient, event-driven updates (no polling).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    handler(mql); // set initial value
    mql.addEventListener("change", handler as (e: MediaQueryListEvent) => void);
    return () => mql.removeEventListener("change", handler as (e: MediaQueryListEvent) => void);
  }, []);

  return isMobile;
}
