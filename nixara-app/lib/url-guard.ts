/**
 * SSRF guard for user-supplied upstream URLs.
 *
 * SECURITY FIX (H1): /api/connect/tableau took a fully attacker-controlled
 * `server` value straight into fetch(), with no scheme or host validation,
 * and then echoed the upstream response body back to the caller inside the
 * error message. That is a reflected SSRF: a caller could point the route at
 * cloud metadata endpoints (169.254.169.254), at loopback, or at anything on
 * the deploy target's private network, and read the response.
 *
 * This module is the chokepoint. Every route that fetches a host the user
 * named must call assertSafeUpstreamUrl() first, and must report failures
 * with safeUpstreamMessage() rather than the upstream body.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Hostnames that must never be reachable, regardless of what they resolve to. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Suffixes that indicate an internal-only name. */
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/** CIDR blocks that are private, reserved, or otherwise not routable on the public internet. */
const BLOCKED_V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],        // "this" network
  ["10.0.0.0", 8],       // RFC1918 private
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],    // RFC1918 private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.168.0.0", 16],   // RFC1918 private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, incl. 255.255.255.255 broadcast
];

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable — fail closed
  for (const [base, bits] of BLOCKED_V4_RANGES) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return true;
  }
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms — judge by the v4 part.
  const mapped = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isBlockedIPv4(mapped[1]);

  if (lower === "::" || lower === "::1") return true;          // unspecified / loopback
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;           // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;           // fe80::/10 link-local
  if (lower.startsWith("64:ff9b:")) return true;               // NAT64
  if (lower.startsWith("2001:db8:")) return true;              // documentation
  return false;
}

/** True when an IP literal must not be contacted. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // not an IP at all — fail closed
}

/**
 * Validates a user-supplied base URL and returns the parsed URL when it is
 * safe to fetch. Throws UnsafeUrlError otherwise.
 *
 * Checks, in order:
 *   1. Parses as a URL at all.
 *   2. Scheme is https (http would also put the user's PAT on the wire in
 *      plaintext, so this is a credential-protection fix as much as an SSRF one).
 *   3. Carries no embedded credentials (https://user:pass@host).
 *   4. Hostname is not an internal-only name.
 *   5. Every address the hostname resolves to is publicly routable.
 *
 * Residual risk: DNS rebinding. A hostname that resolves to a public address
 * here could resolve to a private one microseconds later when fetch() does its
 * own lookup. Fully closing that requires pinning the resolved IP into the
 * connection and carrying the original Host header, which undici does not
 * expose cleanly. The remaining window is narrow and the payoff is bounded
 * (this route returns CSV, not arbitrary content), so it is accepted and
 * documented rather than silently ignored.
 */
export async function assertSafeUpstreamUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Server address is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("Server address must start with https://");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Server address must not embed credentials.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) {
    throw new UnsafeUrlError("Server address is missing a hostname.");
  }
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("That server address is not reachable from Nixara.");
  }

  // IP literal — judge it directly, no DNS involved.
  if (isIP(host.replace(/^\[|\]$/g, ""))) {
    if (isBlockedAddress(host.replace(/^\[|\]$/g, ""))) {
      throw new UnsafeUrlError("That server address is not reachable from Nixara.");
    }
    return url;
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve that server address.");
  }
  if (resolved.length === 0) {
    throw new UnsafeUrlError("Could not resolve that server address.");
  }
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      throw new UnsafeUrlError("That server address is not reachable from Nixara.");
    }
  }

  return url;
}

/**
 * Maps an upstream HTTP status to a message that is safe to return to the
 * caller. Never include the upstream response body: on an SSRF-shaped request
 * that body IS the exfiltrated content, and even on a legitimate request it
 * can carry internal hostnames, tokens, or stack traces.
 *
 * The full detail is written to the server log instead, where the operator
 * can see it and the caller cannot.
 */
export function safeUpstreamMessage(
  service: string,
  status: number | undefined,
  detail: string,
  context: string
): string {
  console.error(`[${service}] ${context} failed (status=${status ?? "n/a"}): ${detail}`);

  if (status === 401 || status === 403) {
    return `${service} rejected those credentials. Check the token and site, then try again.`;
  }
  if (status === 404) {
    return `${service} could not find that resource. Check the name and try again.`;
  }
  if (status === 429) {
    return `${service} is rate limiting this connection. Wait a moment and try again.`;
  }
  if (status && status >= 500) {
    return `${service} is temporarily unavailable. Please try again shortly.`;
  }
  return `Could not complete the ${service} request. Check the connection details and try again.`;
}
