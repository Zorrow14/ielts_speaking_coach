import Link from "next/link";
import { notFound } from "next/navigation";
import PracticeSession from "@/components/PracticeSession";
import { partSchema } from "@/lib/schemas";

export default async function PracticePartPage({
  params,
}: {
  params: Promise<{ part: string }>;
}) {
  const { part } = await params;
  const parsed = partSchema.safeParse(Number(part));
  if (!parsed.success) notFound();

  return (
    <main className="shell practice-page">
      <header className="practice-page__header">
        <div className="shell__header">
          <p className="eyebrow">Speaking practice</p>
          <h1>Part {parsed.data}</h1>
        </div>
        {/* Top right rather than at the foot of a long page: leaving should be
            easy to find, and well away from the record button. */}
        <Link className="button button--ghost" href="/practice">
          Leave session
        </Link>
      </header>
      <p className="practice-page__note">
        Scores are AI estimates, not official IELTS bands. Your audio is sent
        for marking and never stored.
      </p>

      <PracticeSession part={parsed.data} />
    </main>
  );
}
