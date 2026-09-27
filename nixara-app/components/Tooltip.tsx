"use client";

import type { ReactNode } from "react";

interface TooltipProps {
  /** Plain-language explanation shown on hover/focus. */
  content: string;
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight, dependency-free hover/focus tooltip.
 *
 * Pure CSS (group-hover + group-focus-within), no positioning library and no
 * JS state -- the trigger is expected to be a naturally focusable element (a
 * link or button, which every current caller already is), so it works for
 * both mouse hover and keyboard focus/tab navigation for free.
 *
 * `pointer-events-none` on the bubble keeps it from ever intercepting the
 * hover/click that is meant for the trigger underneath it.
 */
export default function Tooltip({ content, children, className = "" }: TooltipProps) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-20 mt-2 w-max max-w-64 -translate-x-1/2 rounded-md bg-text px-2.5 py-1.5 text-xs leading-snug font-normal text-bg opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
