import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its standard-font .afm files via relative fs paths at
  // runtime; bundling it (the default) breaks that resolution. Keep it
  // external so Node's own require() handles the path correctly.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
