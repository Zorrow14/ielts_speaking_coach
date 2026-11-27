"use client";

/**
 * Review mode: one phrase at a time, say a sentence with it, then grade
 * yourself.
 *
 * The phrase is shown first and the meaning stays hidden until you ask for it,
 * because recalling it is the exercise. There is no scoring and no Gemini call
 * - the honest signal is whether a sentence came out of your mouth easily.
 *
 * Nothing is kept in the browser: each verdict posts to the server, which
 * schedules the next review date.
 */
import { useState } from "react";
import Link from "next/link";
import type { VocabEntry } from "@/lib/db/vocab";

export default function VocabReview({ queue }: { queue: VocabEntry[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ gotIt: number; again: number }>({
    gotIt: 0,
    again: 0,
  });

  const entry = queue[index];

  async function grade(result: "got_it" | "again") {
    if (!entry) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/vocab/${entry.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error ?? "Could not save that.");
        setSaving(false);
        return;
      }
      setDone((current) => ({
        gotIt: current.gotIt + (result === "got_it" ? 1 : 0),
        again: current.again + (result === "again" ? 1 : 0),
      }));
      setRevealed(false);
      setIndex((value) => value + 1);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  if (!entry) {
    return (
      <section className="card">
        <h2>Review finished</h2>
        <p>
          {done.gotIt + done.again === 0
            ? "Nothing was due for review."
            : `${done.gotIt} got it, ${done.again} to see again sooner.`}
        </p>
        <p className="muted">
          Phrases you got come back later: 1, then 3, then 7, then 14 days.
          Anything you marked &ldquo;again&rdquo; comes back tomorrow.
        </p>
        <div className="row">
          <Link className="button" href="/vocab">
            Back to the notebook
          </Link>
          <Link className="button button--quiet" href="/practice">
            Practise speaking
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <p className="muted">
        {index + 1} of {queue.length}
      </p>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      <p className="review__phrase">{entry.phrase}</p>
      <p className="muted">
        Say a sentence of your own using this, out loud, before you look.
      </p>

      {revealed ? (
        <div className="review__reveal">
          {entry.meaning ? (
            <p>
              <strong>Meaning:</strong> {entry.meaning}
            </p>
          ) : (
            <p className="muted">No meaning saved for this one.</p>
          )}
          {entry.example ? (
            <p className="muted">&ldquo;{entry.example}&rdquo;</p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setRevealed(true)}
        >
          Show the meaning
        </button>
      )}

      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => grade("got_it")}
          disabled={saving}
        >
          Got it
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => grade("again")}
          disabled={saving}
        >
          Again
        </button>
      </div>
    </section>
  );
}
