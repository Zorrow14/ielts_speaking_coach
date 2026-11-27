/**
 * One answer on its own page, for deep links from the mistake history.
 *
 * Reuses ResultCard, so the marking looks the same here as it did live.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import ResultCard from "@/components/ResultCard";
import { getAnswerDetail } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { DATE_TIME_FORMAT } from "@/lib/time";

export default async function AnswerPage({
  params,
}: {
  params: Promise<{ answerId: string }>;
}) {
  const { answerId } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see this answer.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  // Filtered by user_id, so another user's answer id is simply not found.
  const data = await getAnswerDetail(answerId, userId);
  if (!data) notFound();

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>
          Part {data.session.part}
          {data.session.topic ? `: ${data.session.topic}` : ""}
        </h1>
        <p className="muted">
          {DATE_TIME_FORMAT.format(data.answer.createdAt)} &middot; scores are
          AI estimates, not official IELTS bands.
        </p>
      </header>

      <ResultCard
        answerId={data.answer.id}
        question={data.answer.question}
        transcript={data.answer.transcript}
        durationSec={data.answer.durationSec}
        wordCount={data.answer.wordCount}
        view={data.answer.view}
      />

      <div className="row">
        <Link className="button button--quiet" href={`/history/${data.session.id}`}>
          Whole session
        </Link>
        <Link className="button button--quiet" href="/mistakes">
          Back to mistakes
        </Link>
      </div>
    </main>
  );
}
