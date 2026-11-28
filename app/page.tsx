import Link from "next/link";
import { auth } from "@/auth";
import Icon from "@/components/Icon";
import { activity, currentStreak, fixTheseFirst } from "@/lib/db/progress";
import type { RepeatedPair } from "@/lib/db/progress";
import { ensureUser } from "@/lib/db/users";
import { signOutAction } from "./actions";
import { APP_TIME_ZONE } from "@/lib/time";

/**
 * Home: what to do next.
 *
 * The one page in the app that leans warm - a greeting, the streak, one
 * mistake to work on - because it is the screen you open every day. The
 * practice and results screens stay exam-quiet.
 *
 * Every number here comes from a query the app already had (currentStreak,
 * activity, fixTheseFirst in lib/db/progress.ts). No new SQL, no Gemini call.
 *
 * If the database is unreachable the page still renders, with the practice
 * button and without the numbers: the way into practice should never depend
 * on the stats loading.
 */

type Summary = {
  streak: number;
  answersToday: number;
  focus: RepeatedPair | null;
};

async function loadSummary(
  userId: string | undefined,
  email: string | undefined,
): Promise<Summary | null> {
  try {
    const id = userId ?? (email ? await ensureUser(email) : undefined);
    if (!id) return null;
    const [streak, today, focus] = await Promise.all([
      currentStreak(id),
      // One day back from today, in the app's time zone: today's row only.
      activity(id, 1),
      fixTheseFirst(id, 1),
    ]);
    return {
      streak,
      answersToday: today.reduce((sum, day) => sum + day.answers, 0),
      focus: focus[0] ?? null,
    };
  } catch {
    return null;
  }
}

const HOUR = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  hourCycle: "h23",
  timeZone: APP_TIME_ZONE,
});

const TODAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: APP_TIME_ZONE,
});

function greeting(now: Date): string {
  const hour = Number(HOUR.format(now));
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** One sentence that says where today stands, without a number to decode. */
function statusLine(summary: Summary | null): string {
  if (!summary) return "Ready when you are.";
  const { answersToday, streak } = summary;
  if (answersToday > 0) {
    return `${answersToday} ${answersToday === 1 ? "answer" : "answers"} today. One more keeps the habit warm.`;
  }
  if (streak > 0) {
    return `Answer one question today to keep your ${streak}-day streak.`;
  }
  return "Nothing yet today. One answer is enough to start.";
}

const PARTS = [
  {
    part: 1,
    title: "Part 1",
    blurb: "Four short questions on everyday topics.",
    length: "About 4 minutes",
  },
  {
    part: 2,
    title: "Part 2",
    blurb: "One cue card: a minute to prepare, two to speak.",
    length: "About 4 minutes",
  },
  {
    part: 3,
    title: "Part 3",
    blurb: "Follow-up discussion built from what you say.",
    length: "About 5 minutes",
  },
] as const;

export default async function Home() {
  const session = await auth();
  const summary = await loadSummary(
    session?.user?.id ?? undefined,
    session?.user?.email ?? undefined,
  );
  const now = new Date();
  const practisedToday = (summary?.answersToday ?? 0) > 0;

  return (
    <main className="shell home">
      <header className="home__hero">
        <p className="eyebrow">{TODAY.format(now)}</p>
        <h1>{greeting(now)}</h1>
        <p className="home__status">{statusLine(summary)}</p>
        <Link className="button button--large" href="/practice">
          <Icon name="mic" />
          {practisedToday ? "Continue practising" : "Start today's practice"}
        </Link>
      </header>

      {summary ? (
        <div className="home__grid">
          <section className="card home__streak" aria-labelledby="streak-title">
            <div className="home__streak-figure">
              <Icon name="flame" />
              <span className="home__streak-number">{summary.streak}</span>
            </div>
            <div>
              <h2 id="streak-title" className="home__card-title">
                {summary.streak === 1 ? "day in a row" : "days in a row"}
              </h2>
              <p className="muted">
                {summary.streak === 0
                  ? "Your streak starts with today's first answer."
                  : practisedToday
                    ? "Today counts. Come back tomorrow to extend it."
                    : "Practise today to keep it going."}
              </p>
            </div>
          </section>

          <section className="card home__focus" aria-labelledby="focus-title">
            <p id="focus-title" className="eyebrow">
              Today&apos;s focus
            </p>
            {summary.focus ? (
              <>
                <p className="home__focus-pair">
                  <s>{summary.focus.original}</s>
                  <Icon name="arrowRight" className="home__focus-arrow" />
                  <strong>{summary.focus.correction}</strong>
                </p>
                <p className="muted">
                  <span className="badge">
                    {summary.focus.category.replace(/_/g, " ")}
                  </span>{" "}
                  Made {summary.focus.last7 + summary.focus.previous7} times in
                  the last two weeks.
                </p>
                <Link className="button button--ghost" href="/mistakes">
                  See all repeated mistakes
                  <Icon name="arrowRight" />
                </Link>
              </>
            ) : (
              <p className="muted">
                After a few answers, the mistake you repeat most will show up
                here as the one thing to work on.
              </p>
            )}
          </section>
        </div>
      ) : null}

      <section className="home__parts" aria-labelledby="parts-title">
        <h2 id="parts-title">Practise a part</h2>
        <ul className="part-list" role="list">
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
      </section>

      <footer className="home__footer">
        <p className="muted">
          Scores are AI estimates, not official IELTS bands.
        </p>
        <form action={signOutAction} className="home__signout">
          <span className="muted">
            Signed in as {session?.user?.email ?? "unknown"}
          </span>
          <button type="submit" className="button button--ghost button--tiny">
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
