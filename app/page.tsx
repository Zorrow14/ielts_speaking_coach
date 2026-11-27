import Link from "next/link";
import { auth, signOut } from "@/auth";

/**
 * Protected home page. Middleware already redirects anonymous visitors to
 * /login, so a session is expected here; the guard is belt and braces.
 */
export default async function Home() {
  const session = await auth();

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>IELTS Speaking Coach</h1>
        <p className="muted">
          Scores are AI estimates, not official IELTS results.
        </p>
      </header>

      <section className="card">
        <h2>Practise</h2>
        <p className="muted">
          Part 1, 2 or 3. Record an answer and get a criterion-based estimate
          with your transcript and corrections.
        </p>
        <div className="row">
          <Link className="button" href="/practice">
            Start a session
          </Link>
          <Link className="button button--quiet" href="/history">
            History
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Track it</h2>
        <p className="muted">
          Trends, repeated mistakes and your notebook are all built from saved
          answers. Nothing here needs a new AI call.
        </p>
        <div className="row">
          <Link className="button button--quiet" href="/progress">
            Progress
          </Link>
          <Link className="button button--quiet" href="/mistakes">
            Mistakes
          </Link>
          <Link className="button button--quiet" href="/vocab">
            Vocabulary
          </Link>
          <Link className="button button--quiet" href="/weekly">
            Weekly report
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Signed in</h2>
        <p>
          <strong>{session?.user?.email ?? "unknown email"}</strong>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="button button--quiet">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
