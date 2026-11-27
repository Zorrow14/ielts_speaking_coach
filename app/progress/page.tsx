/**
 * Progress. A server component: the aggregation already happens in Postgres,
 * so the page reads the same functions /api/progress does rather than fetching
 * its own route over HTTP.
 *
 * The part filter is a plain link per part, which keeps it working without
 * JavaScript and makes each view a shareable URL.
 */
import Link from "next/link";
import { auth } from "@/auth";
import ProgressCharts from "@/components/ProgressCharts";
import { ensureUser } from "@/lib/db/users";
import {
  activity,
  baseline,
  currentStreak,
  promptWindows,
  scoreSeries,
  type BucketAverage,
} from "@/lib/db/progress";
import { partSchema, type Part } from "@/lib/schemas";
import { APP_TIME_ZONE } from "@/lib/time";

const CRITERIA = [
  { key: "overall", label: "Overall" },
  { key: "fluency", label: "Fluency and Coherence" },
  { key: "lexical", label: "Lexical Resource" },
  { key: "grammar", label: "Grammatical Range" },
  { key: "pronunciation", label: "Pronunciation (indicator)" },
] as const;

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ part?: string }>;
}) {
  const { part: partRaw } = await searchParams;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see your progress.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const parsed = partRaw ? partSchema.safeParse(Number(partRaw)) : null;
  const part: Part | undefined = parsed?.success ? parsed.data : undefined;

  const [series, activityDays, streak, base, prompts] = await Promise.all([
    scoreSeries(userId, part),
    activity(userId),
    currentStreak(userId),
    baseline(userId, part),
    promptWindows(userId, part),
  ]);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Progress</h1>
        <p className="muted">
          Every score here is an AI estimate, not an official IELTS band. Days
          are counted in {APP_TIME_ZONE.replace("_", " ")}.
        </p>
      </header>

      <nav className="filters" aria-label="Filter by part">
        <FilterLink current={part} value={undefined} label="All parts" />
        <FilterLink current={part} value={1} label="Part 1" />
        <FilterLink current={part} value={2} label="Part 2" />
        <FilterLink current={part} value={3} label="Part 3" />
      </nav>

      <section className="card">
        <h2>Practice streak</h2>
        <p className="big-clock">
          {streak} {streak === 1 ? "day" : "days"}
        </p>
        <p className="muted">
          {streak === 0
            ? "No practice today or yesterday. Recording one answer starts a streak."
            : "Consecutive days with at least one answer, ending today or yesterday."}
        </p>
      </section>

      <BaselineCard baseline={base} />

      {series.length === 0 ? (
        <section className="card">
          <p>
            No marked answers yet.{" "}
            <Link href="/practice">Record one to start building a trend.</Link>
          </p>
        </section>
      ) : (
        <ProgressCharts
          series={series}
          activity={activityDays}
          promptVersions={prompts}
        />
      )}
    </main>
  );
}

function FilterLink({
  current,
  value,
  label,
}: {
  current: Part | undefined;
  value: Part | undefined;
  label: string;
}) {
  const active = current === value;
  return (
    <Link
      className={`chip${active ? " chip--active" : ""}`}
      href={value ? `/progress?part=${value}` : "/progress"}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

function BaselineCard({
  baseline: data,
}: {
  baseline: {
    first: BucketAverage;
    recent: BucketAverage;
    totalAnswers: number;
    comparable: boolean;
  };
}) {
  if (data.totalAnswers === 0) {
    return (
      <section className="card">
        <h2>Baseline vs now</h2>
        <p className="muted">Nothing to compare yet.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Baseline vs now</h2>
      <p className="estimate-note">AI estimates, not official IELTS bands.</p>
      <p className="muted">
        Your first {data.first.answers} marked{" "}
        {data.first.answers === 1 ? "answer" : "answers"} against your most
        recent {data.recent.answers}.
      </p>

      {!data.comparable ? (
        <p className="alert alert--soft">
          Only {data.totalAnswers}{" "}
          {data.totalAnswers === 1 ? "answer" : "answers"} so far, so these two
          groups share answers and the comparison is not yet meaningful. It
          becomes a real comparison at 10.
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">First {data.first.answers}</th>
              <th scope="col">Last {data.recent.answers}</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map(({ key, label }) => {
              const from = data.first[key];
              const to = data.recent[key];
              const delta = from !== null && to !== null ? to - from : null;
              return (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{from?.toFixed(2) ?? "n/a"}</td>
                  <td>{to?.toFixed(2) ?? "n/a"}</td>
                  <td>
                    {delta === null
                      ? "n/a"
                      : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
