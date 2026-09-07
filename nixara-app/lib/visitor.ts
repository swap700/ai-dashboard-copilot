/**
 * Persistent (not tab-scoped) client identity, used only for the greeting's
 * cross-visit continuity -- pending-decision count, drift-detected-overnight
 * status, and (via list_decisions_for_visitor) the full-history views on the
 * Inbox and Memory pages.
 *
 * Deliberately separate from session-context.tsx's session_id: that one is
 * intentionally tab-lifetime (sessionStorage -- see its own header comment),
 * which is the right scope for the free-tier display counter and for "list
 * only what THIS session created." A greeting that has to say something true
 * about "since your last visit" or "overnight" cannot be built on something
 * that resets every time a tab closes -- hence a second token, stored
 * somewhere that outlives the tab.
 *
 * Same capability-token model as session_id: an unguessable client-generated
 * UUID, checked by SECURITY DEFINER RPCs that only ever compare it as a
 * value. Nothing about switching the storage layer from sessionStorage to
 * localStorage changes that model -- it only changes how long the token
 * survives.
 */

const VISITOR_ID_KEY = "nixara_visitor_id";

export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(VISITOR_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(VISITOR_ID_KEY, fresh);
  return fresh;
}
