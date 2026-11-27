"use client";

/**
 * The notebook list, with inline edit and delete.
 *
 * Client-side because editing and deleting are per-row, but the data arrives
 * from the server already filtered - this component never fetches the whole
 * notebook to filter it in the browser. Search and the source filter are
 * links, handled by the page.
 */
import { useState } from "react";
import Link from "next/link";
import type { VocabEntry } from "@/lib/db/vocab";
import { DAY_FORMAT } from "@/lib/time";

export default function VocabList({ entries }: { entries: VocabEntry[] }) {
  const [rows, setRows] = useState(entries);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/vocab/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete that entry.");
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
  }

  async function save(id: string, fields: Partial<VocabEntry>) {
    setError(null);
    const response = await fetch(`/api/vocab/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase: fields.phrase,
        meaning: fields.meaning ?? null,
        example: fields.example ?? null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Could not save that change.");
      return;
    }
    setRows((current) =>
      current.map((row) => (row.id === id ? data.entry : row)),
    );
    setEditing(null);
  }

  if (rows.length === 0) {
    return <p className="muted">Nothing saved yet for this filter.</p>;
  }

  return (
    <>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="vocab-list">
        {rows.map((entry) =>
          editing === entry.id ? (
            <EditRow
              key={entry.id}
              entry={entry}
              onCancel={() => setEditing(null)}
              onSave={(fields) => save(entry.id, fields)}
            />
          ) : (
            <li key={entry.id}>
              <p className="vocab-list__phrase">{entry.phrase}</p>
              {entry.meaning ? <p>{entry.meaning}</p> : null}
              {entry.example ? (
                <p className="muted vocab-list__example">
                  &ldquo;{entry.example}&rdquo;
                </p>
              ) : null}
              <p className="muted">
                {entry.sourceAnswerId ? (
                  <>
                    From feedback &middot;{" "}
                    <Link href={`/history/answer/${entry.sourceAnswerId}`}>
                      see the answer
                    </Link>
                  </>
                ) : (
                  "Added by hand"
                )}
                {" · "}
                saved {DAY_FORMAT.format(new Date(entry.createdAt))}
                {entry.reviewCount > 0
                  ? ` · reviewed ${entry.reviewCount}×`
                  : ""}
                {entry.nextReview
                  ? ` · next review ${DAY_FORMAT.format(new Date(entry.nextReview))}`
                  : ""}
              </p>
              <div className="row">
                <button
                  type="button"
                  className="button button--tiny"
                  onClick={() => setEditing(entry.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--tiny button--quiet"
                  onClick={() => remove(entry.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </>
  );
}

function EditRow({
  entry,
  onCancel,
  onSave,
}: {
  entry: VocabEntry;
  onCancel: () => void;
  onSave: (fields: Partial<VocabEntry>) => void;
}) {
  const [fields, setFields] = useState({
    phrase: entry.phrase,
    meaning: entry.meaning ?? "",
    example: entry.example ?? "",
  });

  return (
    <li>
      <div className="field">
        <label htmlFor={`edit-phrase-${entry.id}`}>Phrase</label>
        <input
          id={`edit-phrase-${entry.id}`}
          value={fields.phrase}
          onChange={(event) =>
            setFields({ ...fields, phrase: event.target.value })
          }
        />
      </div>
      <div className="field">
        <label htmlFor={`edit-meaning-${entry.id}`}>What it means</label>
        <input
          id={`edit-meaning-${entry.id}`}
          value={fields.meaning}
          onChange={(event) =>
            setFields({ ...fields, meaning: event.target.value })
          }
        />
      </div>
      <div className="field">
        <label htmlFor={`edit-example-${entry.id}`}>Example</label>
        <textarea
          id={`edit-example-${entry.id}`}
          rows={2}
          value={fields.example}
          onChange={(event) =>
            setFields({ ...fields, example: event.target.value })
          }
        />
      </div>
      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => onSave(fields)}
          disabled={!fields.phrase.trim()}
        >
          Save
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </li>
  );
}
