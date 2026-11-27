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
  if (value === null) return <span className="muted">—</span>;
  if (value === 0) return <span className="muted">no change</span>;
  const up = value > 0;
  return (
    <span className={up ? "delta delta--up" : "delta delta--down"}>
      {up ? "+" : ""}
      {value.toFixed(1)} {up ? "higher" : "lower"}
    </span>
  );
}

function MistakeList({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: Mistake[];
}) {
  return (
    <section className="compare__mistakes">
      <h4>
        {title} <span className="muted">({items.length})</span>
      </h4>
      <p className="muted">{note}</p>
      {items.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul>
          {items.map((mistake, index) => (
            <li key={`${mistake.original}-${index}`}>
              <span className="tag">{mistake.category.replace(/_/g, " ")}</span>{" "}
              <s>{mistake.original}</s> → <strong>{mistake.correction}</strong>
              {mistake.explanation ? (
                <div className="muted">{mistake.explanation}</div>
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
    <section className="card compare">
      <h3>First attempt vs this one</h3>
      <p className="muted">
        Both are AI estimates, so the difference is an estimate too. This
        attempt is not counted in your progress trend.
      </p>

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
            <tr key={key}>
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
            <td>{data.first.wordCount ?? "—"}</td>
            <td>{data.latest.wordCount ?? "—"}</td>
            <td className="muted">—</td>
          </tr>
        </tbody>
      </table>

      <p className="muted">
        Pronunciation is left out of this table deliberately: it is an
        indicator, not a band, and comparing two indicators invites reading
        more into it than it can carry.
      </p>

      <MistakeList
        title="Fixed"
        note="In your first attempt, gone from this one."
        items={data.fixed}
      />
      <MistakeList
        title="Still there"
        note="You made the same mistake again. These are the ones to drill."
        items={data.repeated}
      />
      <MistakeList
        title="New this time"
        note="Not in the first attempt. Often the price of trying something harder."
        items={data.introduced}
      />
    </section>
  );
}
