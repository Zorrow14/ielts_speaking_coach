import Link from "next/link";
import { notFound } from "next/navigation";
import GuestBotId from "@/components/GuestBotId";
import GuestSession from "@/components/GuestSession";
import { guestModeEnabled } from "@/lib/guest/config";

/**
 * Rendered per request, not prerendered. This page reads an env var, and a
 * prerendered copy would bake the value in at build time - which would mean
 * the GUEST_MODE_ENABLED kill switch needed a redeploy to take effect. It has
 * to be immediate.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Try IELTS Speaking Coach as a guest",
  description:
    "Practise one IELTS Speaking answer and get criterion-based feedback estimates. Nothing is saved.",
};

/**
 * The guest entry page. Public by design - see the note in auth.config.ts.
 *
 * When the kill switch is off this 404s rather than showing a disabled
 * message, so a turned-off feature leaves no trace to probe.
 */
export default function GuestPage() {
  if (!guestModeEnabled()) notFound();

  return (
    <main className="shell">
      <GuestBotId />

      <header className="shell__header">
        <h1>Try it as a guest</h1>
        <p className="muted">
          One practice answer, marked against the four IELTS Speaking criteria.
          No account, no password, nothing saved.
        </p>
      </header>

      <GuestSession />

      <section className="card">
        <h2>What this is not</h2>
        <p className="muted">
          Scores are estimates produced by an AI model, not official IELTS
          bands, and this app is not affiliated with or endorsed by IELTS or its
          owners. Pronunciation is an indicator only.
        </p>
        <div className="row">
          <Link className="button button--quiet" href="/privacy">
            Privacy
          </Link>
          <Link className="button button--quiet" href="/terms">
            Terms
          </Link>
          <Link className="button button--quiet" href="/login">
            Owner sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
