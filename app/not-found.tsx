import Link from "next/link";

/**
 * Not found. Reached both by a bad URL and by notFound() in a page whose
 * record does not exist OR belongs to someone else - the user_id filter makes
 * those two cases indistinguishable from the outside, which is intended: it
 * leaks nothing about whether an id exists.
 */
export default function NotFound() {
  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Not found</h1>
      </header>
      <section className="card">
        <p>That page or answer does not exist.</p>
        <div className="row">
          <Link className="button" href="/practice">
            Practise
          </Link>
          <Link className="button button--quiet" href="/history">
            History
          </Link>
        </div>
      </section>
    </main>
  );
}
