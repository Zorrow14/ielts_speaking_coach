/**
 * Weekly report: the last 7 days against the 7 before, and against the
 * baseline.
 *
 * Every average states how many answers it came from, and anything under
 * MIN_ANSWERS_FOR_CONCLUSION is labelled as too small a sample rather than
 * quietly presented as a trend. That matters more here than anywhere else in
 * the app: a weekly report invites you to draw a conclusion, so it has to be
 * honest about when there is nothing to conclude.
 */
import Link from "next/link";
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import {
  baseline,
  currentStreak,
  mistakesByCategory,
  repeatedPairs,
  weekComparison,
  type BucketAverage,
} from "@/lib/db/progress";
import { MIN_ANSWERS_FOR_CONCLUSION, focusPoints } from "@/lib/focus";
import type { MistakeCategory } from "@/lib/schemas";

const CRITERIA = [
  { key: "overall", label: "Overall" },
  { key: "fluency", label: "Fluency and Coherence" },
  { key: "lexical", label: "Lexical Resource" },
  { key: "grammar", label: "Grammatical Range" },
  { key: "pronunciation", label: "Pronunciation (indicator)" },
] as const;

const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  article: "Articles",
  preposition: "Prepositions",
  countability: "Countable / uncountable",
  agreement: "Agreement",
  tense: "Tense",
  word_choice: "Word choice",
  collocation: "Collocation",
  repetition: "Repetition",
  fluency: "Fluency",
  other: "Other",
};

function delta(from: number | null, to: number | null): string {
  if (from === null || to === null) return "n/a";
  const change = to - from;
  if (Math.abs(change) < 0.005) return "no change";
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}`;
}

export default async function WeeklyPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see your weekly report.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const [weeks, base, categories, repeated, streak] = await Promise.all([
    weekComparison(userId),
    baseline(userId),
    mistakesByCategory(userId),
    repeatedPairs(userId, {}, 10),
    currentStreak(userId),
  ]);

  const smallSample = weeks.thisWeek.answers < MIN_ANSWERS_FOR_CONCLUSION;
  const points = focusPoints({
    thisWeek: weeks.thisWeek,
    lastWeek: weeks.lastWeek,
    categories,
    repeated,
    streak,
    answersThisWeek: weeks.thisWeek.answers,
  });

  const topThree = [...categories]
    .filter((row) => row.last7 > 0)
    .sort((a, b) => b.last7 - a.last7)
    .slice(0, 3);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Weekly report</h1>
        <p className="muted">
          The last 7 days. All scores are AI estimates, not official IELTS
          bands.
        </p>
      </header>

      <section className="card">
        <h2>
          {weeks.thisWeek.answers}{" "}
          {weeks.thisWeek.answers === 1 ? "answer" : "answers"} this week
        </h2>
        <p className="muted">
          {weeks.lastWeek.answers} the week before &middot; current streak{" "}
          {streak} {streak === 1 ? "day" : "days"}
        </p>
        {weeks.thisWeek.answers === 0 ? (
          <p className="alert alert--soft">
            Nothing recorded in the last 7 days, so there is nothing to report.{" "}
            <Link href="/practice">Record an answer</Link> and come back.
          </p>
        ) : smallSample ? (
          <p className="alert alert--soft">
            Only {weeks.thisWeek.answers}{" "}
            {weeks.thisWeek.answers === 1 ? "answer" : "answers"} this week.
            That is too small a sample to draw a conclusion from &mdash; treat
            every number below as an indication, not a trend. {MIN_ANSWERS_FOR_CONCLUSION}{" "}
            answers is the minimum worth comparing.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>This week vs last week vs baseline</h2>
        <p className="estimate-note">AI estimates, not official IELTS bands.</p>
        <p className="muted">
          This week: {weeks.thisWeek.answers}{" "}
          {weeks.thisWeek.answers === 1 ? "answer" : "answers"}. Last week:{" "}
          {weeks.lastWeek.answers}. Baseline: your first {base.first.answers}{" "}
          ever.
        </p>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">This week</th>
                <th scope="col">Last week</th>
                <th scope="col">Change</th>
                <th scope="col">Baseline</th>
                <th scope="col">vs baseline</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map(({ key, label }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{format(weeks.thisWeek, key)}</td>
                  <td>{format(weeks.lastWeek, key)}</td>
                  <td>{delta(weeks.lastWeek[key], weeks.thisWeek[key])}</td>
                  <td>{format(base.first, key)}</td>
                  <td>{delta(base.first[key], weeks.thisWeek[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!base.comparable ? (
          <p className="muted">
            The baseline column shares answers with your recent ones &mdash;
            you have {base.totalAnswers} in total, and it takes 10 before
            baseline and now are separate groups.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>Most repeated mistakes this week</h2>
        {topThree.length === 0 ? (
          <p className="muted">
            No mistakes recorded in the last 7 days.
          </p>
        ) : (
          <ol className="bullets bullets--ranked">
            {topThree.map((row) => (
              <li key={row.category}>
                <strong>{CATEGORY_LABEL[row.category]}</strong> &mdash;{" "}
                {row.last7} this week, {row.previous7} the week before
                {row.change < 0 ? (
                  <span className="muted"> (fading)</span>
                ) : row.change > 0 ? (
                  <span className="muted"> (up)</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <Link className="button button--quiet" href="/mistakes">
          All mistakes
        </Link>
      </section>

      <section className="card card--priority">
        <h2>Three things to focus on</h2>
        <p className="muted">
          Worked out from your own saved results. No new AI call, so you can
          check every number behind them.
        </p>
        <ol className="bullets bullets--ranked">
          {points.map((point, index) => (
            <li key={index}>
              {point.title}
              <p className="muted">
                {point.because}
                {point.weak ? " Small sample - treat with caution." : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function format(bucket: BucketAverage, key: (typeof CRITERIA)[number]["key"]) {
  const value = bucket[key];
  return value === null ? "n/a" : value.toFixed(2);
}
