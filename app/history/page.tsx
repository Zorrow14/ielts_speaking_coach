import Link from "next/link";
import { auth } from "@/auth";
import { listSessions } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";

export const metadata = { title: "History | IELTS Speaking Coach" };

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function HistoryPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see your history.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));
  const rows = await listSessions(userId);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>History</h1>
        <p className="muted">
          Every overall figure is an AI estimate, not an official IELTS band.
        </p>
      </header>

      {rows.length === 0 ? (
        <section className="card">
          <p>No sessions yet.</p>
          <Link className="button" href="/practice">
            Start practising
          </Link>
        </section>
      ) : (
        <ul className="history">
          {rows.map((row) => (
            <li key={row.id}>
              <Link className="card card--link" href={`/history/${row.id}`}>
                <p className="history__meta">
                  <strong>Part {row.part}</strong>
                  <span className="muted">
                    {" "}
                    &middot; {DATE_FORMAT.format(row.startedAt)}
                  </span>
                </p>
                <p>{row.topic ?? "Untitled topic"}</p>
                <p className="muted">
                  {row.answerCount}{" "}
                  {row.answerCount === 1 ? "answer" : "answers"}
                  {row.overall
                    ? ` · overall estimate ${row.overall}`
                    : " · not marked"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link className="button button--quiet" href="/">
        Back
      </Link>
    </main>
  );
}
