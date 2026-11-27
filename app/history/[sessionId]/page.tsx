import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import ResultCard from "@/components/ResultCard";
import { getSession } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const auth_ = await auth();
  const email = auth_?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see this session.</p>
      </main>
    );
  }
  const userId = auth_.user.id ?? (await ensureUser(email));

  // getSession filters by user_id, so another user's id simply looks missing.
  const data = await getSession(sessionId, userId);
  if (!data) notFound();

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>
          Part {data.session.part}
          {data.session.topic ? `: ${data.session.topic}` : ""}
        </h1>
        <p className="muted">
          {DATE_FORMAT.format(data.session.startedAt)} &middot; scores are AI
          estimates, not official IELTS bands.
        </p>
      </header>

      {data.answers.length === 0 ? (
        <section className="card">
          <p>This session has no saved answers.</p>
        </section>
      ) : (
        data.answers.map((answer) => (
          <ResultCard
            key={answer.id}
            question={answer.question}
            transcript={answer.transcript}
            durationSec={answer.durationSec}
            wordCount={answer.wordCount}
            view={answer.view}
            answerId={answer.id}
          />
        ))
      )}

      <Link className="button button--quiet" href="/history">
        Back to history
      </Link>
    </main>
  );
}
