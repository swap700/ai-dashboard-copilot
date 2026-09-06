import type { NextConfig } from "next";

// Security headers applied to every route.
//
// M2 (2026-09): script-src no longer carries 'unsafe-eval' in production. Next
// only needs it for the dev-time refresh runtime, so allowing it in prod widens
// the surface for nothing. 'unsafe-inline' stays for now because the App Router
// emits inline hydration scripts; removing it means generating a per-request
// nonce in middleware and threading it through, which is a real change and is
// tracked separately rather than half-done here.
//
// Also removed: api.openai.com from connect-src (the browser never calls
// OpenAI directly - the key goes to a server route), and the Google Fonts
// origins (next/font self-hosts the font at build time, so nothing is fetched
// from Google at runtime).
const isDev = process.env.NODE_ENV !== "production";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(isDev ? ["'unsafe-eval'"] : []),
].join(" ");

const securityHeaders = [
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options",  value: "nosniff" },
  // Block clickjacking
  { key: "X-Frame-Options",         value: "SAMEORIGIN" },
  // Limit referrer information
  { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
  // Restrict browser features
  { key: "Permissions-Policy",      value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Force HTTPS for 1 year
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // pdfkit reads its standard-font .afm files via relative fs paths at
  // runtime; bundling it (the default) breaks that resolution. Keep it
  // external so Node's own require() handles the path correctly.
  serverExternalPackages: ["pdfkit"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
