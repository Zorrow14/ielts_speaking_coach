"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where
 * app/error.tsx cannot render because the layout never mounted. It must supply
 * its own <html> and <body>, and it cannot rely on the stylesheet, so the few
 * styles it needs are inline.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: "1.3rem" }}>IELTS Speaking Coach</h1>
        <p>The app failed to start. Reloading usually fixes it.</p>
        {error.digest ? (
          <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <p>
          {/* A plain anchor on purpose: this boundary catches a failed root
              layout, where the router may not be mounted, so next/link
              cannot be relied on to navigate. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Reload</a>
        </p>
      </body>
    </html>
  );
}
