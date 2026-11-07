import type { NextConfig } from "next";

/**
 * `'unsafe-inline'` for scripts is what the static shell needs: Next writes inline bootstrap scripts into
 * prerendered pages, and nonces would force every page dynamic. `connect-src 'self'` is the real limit:
 * injected script couldn't send anything anywhere, and wallets are extensions, outside this policy.
 */
const contentSecurityPolicy = (frameAncestors: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Merchants embed this on their own sites, so `proxy.ts` sets its policy from the widget's site.
      { source: "/embed/:path*", headers: common },
      // Everything else refuses to be framed.
      { source: "/((?!embed/).*)", headers: [...common, { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'") }, { key: "X-Frame-Options", value: "DENY" }] },
      // The loader runs on merchants' pages, so it needs to be fetched from anywhere.
      { source: "/widget.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=300" }, { key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
    ];
  },
};

export default nextConfig;
