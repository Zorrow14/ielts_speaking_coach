import Link from "next/link";

export const metadata = { title: "Practise | IELTS Speaking Coach" };

const PARTS = [
  {
    part: 1,
    title: "Part 1",
    blurb: "Four short questions on everyday topics. Two to four sentences each.",
  },
  {
    part: 2,
    title: "Part 2",
    blurb: "One cue card. A minute to prepare, then speak for two minutes.",
  },
  {
    part: 3,
    title: "Part 3",
    blurb: "Four follow-up questions, each built from what you just said.",
  },
];

export default function PracticeIndex() {
  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Choose a part</h1>
        <p className="muted">
          Scores are AI estimates, not official IELTS bands.
        </p>
      </header>

      {PARTS.map((entry) => (
        <Link key={entry.part} className="card card--link" href={`/practice/${entry.part}`}>
          <h2>{entry.title}</h2>
          <p className="muted">{entry.blurb}</p>
        </Link>
      ))}

      <Link className="button button--quiet" href="/">
        Back
      </Link>
    </main>
  );
}
