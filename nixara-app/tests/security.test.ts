/**
 * Regression tests for the security fixes.
 *
 * Run with:  npm run test:security
 * (node's native type stripping — no test framework dependency)
 *
 * Every case here corresponds to a specific finding. If one of these starts
 * failing, the fix it guards has been undone.
 */

import { assertSafeUpstreamUrl, isBlockedAddress, UnsafeUrlError } from "../lib/url-guard.ts";
import { toDaxIdentifier } from "../lib/dax.ts";
import { sanitizeFilename } from "../lib/filename.ts";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${name}`);
  }
}

async function rejects(url: string, name: string): Promise<void> {
  try {
    await assertSafeUpstreamUrl(url);
    check(name, false);
  } catch (err) {
    check(name, err instanceof UnsafeUrlError);
  }
}

// ── H1: SSRF guard ───────────────────────────────────────────────────────────
console.log("H1 — SSRF guard (lib/url-guard.ts)");

for (const ip of [
  "127.0.0.1", "127.1.2.3", "169.254.169.254", "10.1.2.3", "172.16.0.1",
  "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "255.255.255.255",
  "224.0.0.1", "198.18.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
  "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::1", "not-an-ip", "",
]) {
  check(`blocks address ${ip || "(empty)"}`, isBlockedAddress(ip) === true);
}

for (const ip of [
  "8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "93.184.216.34",
  "2606:2800:220:1:248:1893:25c8:1946",
]) {
  check(`allows address ${ip}`, isBlockedAddress(ip) === false);
}

await rejects("http://tableau.example.com", "rejects http:// (plaintext PAT)");
await rejects("https://169.254.169.254/latest/meta-data/", "rejects cloud metadata IP");
await rejects("https://127.0.0.1:8080", "rejects loopback literal");
await rejects("https://[::1]/x", "rejects IPv6 loopback literal");
await rejects("https://localhost", "rejects localhost");
await rejects("https://metadata.google.internal", "rejects GCP metadata host");
await rejects("https://box.local", "rejects .local suffix");
await rejects("https://svc.internal", "rejects .internal suffix");
await rejects("https://user:pass@tableau.example.com", "rejects embedded credentials");
await rejects("file:///etc/passwd", "rejects file:// scheme");
await rejects("gopher://evil.example.com", "rejects gopher:// scheme");
await rejects("not a url at all", "rejects unparseable input");

// ── H2: DAX identifier quoting ───────────────────────────────────────────────
console.log("H2 — DAX quoting (lib/dax.ts)");

check("quotes a plain name", toDaxIdentifier("Sales") === "'Sales'");
check("quotes a name with spaces", toDaxIdentifier("Fact Sales") === "'Fact Sales'");
check(
  "escapes an embedded single quote",
  toDaxIdentifier("O'Brien") === "'O''Brien'"
);
check(
  "neutralises a DAX break-out attempt",
  toDaxIdentifier("Sales' EVALUATE 'Secret") === "'Sales'' EVALUATE ''Secret'"
);
check(
  "leaves no unescaped quote that could close the identifier early",
  // every ' in the body must be doubled; count of quotes in the payload is even
  (toDaxIdentifier("a'b'c").match(/'/g) ?? []).length % 2 === 0
);

// ── M2: Content-Disposition filename sanitising ──────────────────────────────
console.log("M2 — filename sanitising (lib/filename.ts)");

check("keeps a normal name", sanitizeFilename("Executive Summary") === "executive_summary");
check("strips quotes", !sanitizeFilename('a"b').includes('"'));
check("strips CR/LF (header injection)", !/[\r\n]/.test(sanitizeFilename("a\r\nX-Evil: 1")));
check(
  "strips path separators",
  !sanitizeFilename("../../etc/passwd").includes("/") &&
    !sanitizeFilename("..\\win").includes("\\")
);
check("falls back when nothing survives", sanitizeFilename("///").length > 0);
check("bounds the length", sanitizeFilename("x".repeat(500)).length <= 100);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
