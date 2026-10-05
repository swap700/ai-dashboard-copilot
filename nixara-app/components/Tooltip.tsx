"use client";

import type { ReactNode } from "react";

interface TooltipProps {
  /** Plain-language explanation shown on hover/focus. */
  content: string;
  children: ReactNode;
  className?: string;
  /** "start" left-aligns the bubble with the trigger (use near a left edge); default centers it. */
  align?: "center" | "start";
  /**
   * Forces the bubble visible. Hover and keyboard focus already work with no
   * state, but iOS Safari does not focus a button on tap, so a touch-friendly
   * caller toggles this from its own onClick. Existing callers omit it.
   */
  open?: boolean;
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
export default function Tooltip({ content, children, className = "", align = "center", open }: TooltipProps) {
  // Controlled mode (a caller passes `open`): only KEYBOARD focus reveals the bubble.
  // A tapped button also gets plain focus in Chromium, which would otherwise keep the
  // bubble visible after the caller toggled it closed. Uncontrolled callers (the nav
  // tabs) keep the original hover + focus-within behavior unchanged.
  const focusReveal = open === undefined ? "group-focus-within:opacity-100" : "group-has-[:focus-visible]:opacity-100";
  const position = align === "start" ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full ${position} z-20 mt-2 w-max max-w-64 rounded-md bg-text px-2.5 py-1.5 text-xs leading-snug font-normal text-bg ${open ? "opacity-100" : "opacity-0"} shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${focusReveal}`}
      >
        {content}
      </span>
    </span>
  );
}
