"use client";

import { useEffect, useState } from "react";

const LS_KEY = "nixara_oai_key";

/**
 * SECURITY FIX (2026-08): this hook used to persist the pasted OpenAI key to
 * localStorage via a "remember in this browser" checkbox. An unencrypted API
 * key sitting in localStorage is readable by any script that runs on the
 * page (XSS) and by anyone with devtools access to that machine, and it
 * survives indefinitely until manually cleared. Persistence has been removed
 * — the key now lives only in React state for the lifetime of the tab. The
 * one-time migration below clears any key a returning browser had stored
 * under the old behavior, so it doesn't linger on disk.
 */
export function useApiKey() {
  const [apiKey, setApiKey] = useState("");

  // One-time cleanup: remove any key persisted by the old "remember" behavior.
  useEffect(() => {
    if (window.localStorage.getItem(LS_KEY)) {
      window.localStorage.removeItem(LS_KEY);
    }
  }, []);

  return { apiKey, setApiKey };
}
