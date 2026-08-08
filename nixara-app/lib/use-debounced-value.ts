"use client";

import { useEffect, useState } from "react";

/**
 * BUG FIX (2026-08): React error #185 ("Maximum update depth exceeded").
 *
 * Root cause: `Charts` re-runs `selectChartColumns(dataset, decisionText)`
 * on every render, and that function re-scores every categorical/metric
 * column against the current decision text — so which columns get charted
 * (and each chart's data/height) could change on *every keystroke* in the
 * Decision Context textarea. That data/dimension churn, combined with
 * Recharts' internal redux-based store re-dispatching for every prop
 * change, was enough to exceed React's nested-update limit and crash the
 * whole tree — reproducible with plain text, nothing adversarial required.
 *
 * Fix: debounce the text before it reaches chart-column selection, so
 * recharts only re-renders after the user pauses typing instead of on
 * every character.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
