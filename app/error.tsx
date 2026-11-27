"use client";

/**
 * Error boundary for the app segment.
 *
 * Shows the digest, not the message: Next replaces server error messages with
 * an opaque digest in production precisely so internals do not reach the
 * browser, and the digest is what matches the server log line. Quoting it is
 * how a failure gets traced without leaking anything.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Message only, never the stack, and never to a third party.
    console.error(
      JSON.stringify({
        level: "error",
        event: "client_boundary",
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Something broke</h1>
      </header>
      <section className="card">
        <p>
          This page failed to load. Nothing you recorded has been lost &mdash;
          answers that were already marked are saved.
        </p>
        {error.digest ? (
          <p className="muted">
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <div className="row">
          <button type="button" className="button" onClick={reset}>
            Try again
          </button>
          <Link className="button button--quiet" href="/">
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
