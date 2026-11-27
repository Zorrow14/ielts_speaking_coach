import Link from "next/link";
import { signIn } from "@/auth";
import { guestModeEnabled } from "@/lib/guest/config";

/**
 * The page an anonymous visitor actually lands on, so this is where the guest
 * entry point lives. The owner's home page is behind the login wall, and
 * putting a "Try as guest" button there would have meant nobody could see it.
 */
/**
 * Rendered per request, not prerendered. This page reads an env var, and a
 * prerendered copy would bake the value in at build time - which would mean
 * the GUEST_MODE_ENABLED kill switch needed a redeploy to take effect. It has
 * to be immediate.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const guestOpen = guestModeEnabled();

  return (
    <main className="shell shell--centred">
      <section className="card">
        <h1>IELTS Speaking Coach</h1>
        <p className="muted">
          Practise IELTS Speaking Parts 1 to 3 and get criterion-based feedback
          with your transcript, your mistakes and what to fix next.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="button">
            Sign in with GitHub
          </button>
        </form>
        <p className="muted">
          Sign-in is limited to one allow-listed account.
        </p>
      </section>

      {guestOpen ? (
        <section className="card">
          <h2>Just want to see what it does?</h2>
          <p>
            Try it as a guest: record one answer and get the full feedback. No
            account, and nothing you say is saved.
          </p>
          <Link className="button" href="/guest">
            Try as guest
          </Link>
          <p className="muted">
            Your audio is processed by Google&apos;s Gemini API.{" "}
            <Link href="/privacy">What that means</Link>.
          </p>
        </section>
      ) : null}

      <section className="card">
        <p className="muted">
          Scores are AI estimates, not official IELTS bands. This app is not
          affiliated with or endorsed by IELTS or its owners.{" "}
          <Link href="/privacy">Privacy</Link> &middot;{" "}
          <Link href="/terms">Terms</Link>
        </p>
      </section>
    </main>
  );
}
