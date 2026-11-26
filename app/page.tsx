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
          Phase 1 setup. Scores are AI estimates, not official IELTS results.
        </p>
      </header>

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

      {/* TEMPORARY - remove with the health-check route in phase 2. */}
      <section className="card card--temp">
        <h2>Temporary database health check</h2>
        <p className="muted">
          Writes one row to Neon, reads it back, then deletes it. Delete this
          card and <code>app/api/health/db/route.ts</code> once phase 2 writes
          real rows.
        </p>
        <a className="button" href="/api/health/db">
          Run health check
        </a>
      </section>
    </main>
  );
}
