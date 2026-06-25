"use client";

import { useEffect, useState } from "react";

const LS_KEY = "nixara_oai_key";

/**
 * Mirrors the sidebar's API-key + "remember in browser" behavior
 * (lines 1268-1326), simplified — a plain React app doesn't need the
 * Streamlit iframe's localStorage<->query-param reload bridge.
 */
export function useApiKey() {
  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(LS_KEY);
    if (saved) {
      setApiKey(saved);
      setRemember(true);
    }
  }, []);

  useEffect(() => {
    if (remember && apiKey) {
      window.localStorage.setItem(LS_KEY, apiKey);
    } else {
      window.localStorage.removeItem(LS_KEY);
    }
  }, [remember, apiKey]);

  return { apiKey, setApiKey, remember, setRemember };
}
