import path from "node:path";
import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

/**
 * Security headers.
 *
 * The CSP is written for what this app actually loads:
 *
 * - `script-src 'self' 'unsafe-inline'`: Next injects inline bootstrap and
 *   flight-data scripts. Removing 'unsafe-inline' needs per-request nonces
 *   through middleware, which is a bigger change than hardening should make -
 *   noted as an accepted limitation rather than silently ignored.
 * - Vercel BotID serves its invisible challenge from the app's own origin
 *   (withBotId rewrites a path under /), so it needs no extra script-src
 *   host. If a future BotID version loads from a Vercel domain, this is the
 *   line that would have to change.
 * - `style-src` allows inline styles because next/font injects them.
 * - `connect-src 'self'` is enough: the browser never calls Gemini or Neon
 *   directly, which is the whole point of the server-only boundary.
 * - `media-src 'self' blob:` covers MediaRecorder blobs.
 * - `img-src` allows data: for the Chart.js canvas and GitHub avatars.
 * - `frame-ancestors 'none'` plus X-Frame-Options stops clickjacking; this app
 *   is never meant to be embedded.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app needs the microphone and nothing else.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Feedback and transcripts are private; keep them out of shared caches.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const baseConfig: NextConfig = {
  // Pin the workspace root: an unrelated package-lock.json in the home
  // directory otherwise makes Turbopack guess wrong.
  turbopack: { root: path.resolve(__dirname) },

  // Error pages and API errors must not leak the stack or the framework
  // version to the browser.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // Nothing under /api is cacheable: it is all per-user data.
        source: "/api/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

/**
 * withBotId adds the rewrites that serve BotID's client challenge from this
 * origin. It must wrap the config, not be merged into it.
 */
export default withBotId(baseConfig);
