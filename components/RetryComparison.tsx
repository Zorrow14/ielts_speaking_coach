"use client";

/**
 * Two attempts at one question, side by side.
 *
 * Both attempts were marked when they were recorded, so nothing here calls
 * Gemini - it reads `/api/compare/[answerId]`, which is pure SQL.
 *
 * The deltas are the point of the screen, so they are stated as numbers with
 * a direction rather than left for the reader to subtract. Everything stays
 * labelled an estimate, because a difference between two estimates is still
 * an estimate.
 */
import { useEffect, useState } from "react";
import Icon, { type IconName } from "./Icon";

type Mistake = {
  category: string;
  original: string;
  correction: string;
  explanation: string | null;
};

type Attempt = {
  answerId: string;
  createdAt: string;
  attempt: number;
  overall: number | null;
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  durationSec: number | null;
  wordCount: number | null;
};

type Comparison = {
  question: string;
  first: Attempt;
  latest: Attempt;
  delta: {
    overall: number | null;
    fluency: number | null;
    lexical: number | null;
    grammar: number | null;
  };
  fixed: Mistake[];
  repeated: Mistake[];
  introduced: Mistake[];
};

const CRITERIA = [
  ["overall", "Overall"],
  ["fluency", "Fluency and coherence"],
  ["lexical", "Lexical resource"],
  ["grammar", "Grammatical range and accuracy"],
] as const;

function band(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/** A signed delta with a word, so the direction does not rely on colour. */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">&mdash;</span>;
  if (value === 0) return <span className="delta delta--same">no change</span>;
  const up = value > 0;
  return (
    <span className={up ? "delta delta--up" : "delta delta--down"}>
      {up ? "+" : ""}
      {value.toFixed(1)}
      {/* The sign already gives the direction without colour; the word is
          visually dropped on narrow phones to keep the column readable, but
          stays in the page for screen readers. */}
      <span className="delta__word"> {up ? "higher" : "lower"}</span>
    </span>
  );
}

function MistakeList({
  title,
  note,
  items,
  tone,
  icon,
}: {
  title: string;
  note: string;
  items: Mistake[];
  tone: "fixed" | "still" | "new";
  icon: IconName;
}) {
  return (
    <section className={`compare__group compare__group--${tone}`}>
      <h4>
        <Icon name={icon} />
        {title} <span className="compare__count">{items.length}</span>
      </h4>
      <p className="muted">{note}</p>
      {items.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul role="list">
          {items.map((mistake, index) => (
            <li key={`${mistake.original}-${index}`}>
              <span className="badge">{mistake.category.replace(/_/g, " ")}</span>
              <p>
                <s>{mistake.original}</s> &rarr; <strong>{mistake.correction}</strong>
              </p>
              {mistake.explanation ? (
                <p className="muted">{mistake.explanation}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RetryComparison({ answerId }: { answerId: string }) {
  /**
   * The loaded result carries the id it belongs to, rather than being cleared
   * at the top of the effect. Clearing there would be a synchronous setState
   * inside an effect, which React now warns about; comparing ids gives the
   * same "show nothing while the next one loads" behaviour for free.
   */
  const [loaded, setLoaded] = useState<{
    id: string;
    data: Comparison | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/compare/${answerId}`)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        setLoaded(
          response.ok
            ? { id: answerId, data: body as Comparison, error: null }
            : {
                id: answerId,
                data: null,
                error: body.error ?? "Could not load the comparison.",
              },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({
            id: answerId,
            data: null,
            error: "Could not load the comparison.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [answerId]);

  const current = loaded?.id === answerId ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  if (error) {
    return (
      <p className="alert" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p role="status">Comparing your two attempts...</p>;

  return (
    <section className="card compare" aria-label="First attempt compared with this one">
      <header className="compare__head">
        <p className="eyebrow">Second attempt</p>
        <h3>First attempt vs this one</h3>
        <p className="muted">
          Both are AI estimates, so the difference is an estimate too. This
          attempt is not counted in your progress trend.
        </p>
      </header>

      <div className="table-scroll">
        <table className="compare__table">
          <caption className="visually-hidden">
            Band estimates for each attempt at this question, with the change
          </caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">First</th>
              <th scope="col">This time</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map(([key, label]) => (
              <tr key={key} className={key === "overall" ? "compare__overall" : undefined}>
                <th scope="row">{label}</th>
                <td>{band(data.first[key])}</td>
                <td>{band(data.latest[key])}</td>
                <td>
                  <Delta value={data.delta[key]} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Words spoken</th>
              <td>{data.first.wordCount ?? "\u2014"}</td>
              <td>{data.latest.wordCount ?? "\u2014"}</td>
              <td className="muted">&mdash;</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted">
        Pronunciation is left out of this table deliberately: it is an
        indicator, not a band, and comparing two indicators invites reading
        more into it than it can carry.
      </p>

      <div className="compare__groups">
        <MistakeList
          tone="fixed"
          icon="check"
          title="Fixed"
          note="In your first attempt, gone from this one."
          items={data.fixed}
        />
        <MistakeList
          tone="still"
          icon="refresh"
          title="Still there"
          note="You made the same mistake again. These are the ones to drill."
          items={data.repeated}
        />
        <MistakeList
          tone="new"
          icon="sparkle"
          title="New this time"
          note="Not in the first attempt. Often the price of trying something harder."
          items={data.introduced}
        />
      </div>
    </section>
  );
}
