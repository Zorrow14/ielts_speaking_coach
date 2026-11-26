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
    <main className="shell">
      <header className="shell__header">
        <h1>Part {parsed.data}</h1>
        <p className="muted">
          Scores are AI estimates, not official IELTS bands. Your audio is sent
          for marking and never stored.
        </p>
      </header>

      <PracticeSession part={parsed.data} />

      <Link className="button button--quiet" href="/practice">
        Leave this session
      </Link>
    </main>
  );
}
