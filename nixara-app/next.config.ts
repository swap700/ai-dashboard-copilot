import type { NextConfig } from "next";

// Fix M3: security headers applied to every route
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
  // Content Security Policy
  // 'unsafe-inline' is required by Next.js for inline styles and scripts.
  // Tighten to nonce-based CSP once the app stabilises.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co https://api.openai.com",
      "frame-ancestors 'none'",
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
