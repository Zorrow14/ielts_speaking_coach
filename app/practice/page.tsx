import Link from "next/link";

export const metadata = { title: "Practise | IELTS Speaking Coach" };

const PARTS = [
  {
    part: 1,
    title: "Part 1",
    blurb: "Four short questions on everyday topics. Two to four sentences each.",
    length: "About 4 minutes",
  },
  {
    part: 2,
    title: "Part 2",
    blurb: "One cue card. A minute to prepare, then speak for two minutes.",
    length: "About 4 minutes",
  },
  {
    part: 3,
    title: "Part 3",
    blurb: "Four follow-up questions, each built from what you just said.",
    length: "About 5 minutes",
  },
] as const;

export default function PracticeIndex() {
  return (
    <main className="shell">
      <header className="shell__header">
        <p className="eyebrow">Speaking practice</p>
        <h1>Choose a part</h1>
        <p className="muted">
          Scores are AI estimates, not official IELTS bands.
        </p>
      </header>

      <ul className="part-list part-list--stacked" role="list">
        {PARTS.map((entry) => (
          <li key={entry.part}>
            <Link className="card card--link part-card" href={`/practice/${entry.part}`}>
              <span className="part-card__number" aria-hidden="true">
                {entry.part}
              </span>
              <span className="part-card__text">
                <span className="part-card__title">{entry.title}</span>
                <span className="muted">{entry.blurb}</span>
              </span>
              <span className="part-card__length muted">{entry.length}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
