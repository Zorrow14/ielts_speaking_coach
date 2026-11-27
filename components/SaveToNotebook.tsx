"use client";

/**
 * One-tap save of a phrase from the feedback into the vocabulary notebook.
 *
 * Prefilled from the correction that prompted it, but editable before saving -
 * the model's correction is a starting point, not gospel, and the learner
 * should be able to reword it into something they would actually say.
 *
 * `sourceAnswerId` is what later lets the notebook separate phrases captured
 * from feedback from ones typed in by hand.
 */
import { useState } from "react";

type Stage = "idle" | "editing" | "saving" | "saved" | "error";

export default function SaveToNotebook({
  phrase,
  meaning,
  example,
  answerId,
  label = "Save to notebook",
}: {
  phrase: string;
  meaning?: string | null;
  example?: string | null;
  answerId?: string;
  label?: string;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState({
    phrase,
    meaning: meaning ?? "",
    example: example ?? "",
  });

  async function save() {
    setStage("saving");
    try {
      const response = await fetch("/api/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phrase: fields.phrase,
          meaning: fields.meaning || null,
          example: fields.example || null,
          sourceAnswerId: answerId ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save that phrase.");
        setStage("error");
        return;
      }
      setStage("saved");
    } catch {
      setMessage("Could not reach the server. Check your connection.");
      setStage("error");
    }
  }

  if (stage === "saved") {
    return (
      <p className="muted saved-note" role="status">
        Saved to your notebook.
      </p>
    );
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        className="button button--tiny"
        onClick={() => setStage("editing")}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="save-phrase">
      {stage === "error" ? (
        <p className="alert" role="alert">
          {message}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor={`phrase-${answerId ?? "manual"}-${phrase}`}>Phrase</label>
        <input
          id={`phrase-${answerId ?? "manual"}-${phrase}`}
          value={fields.phrase}
          onChange={(event) =>
            setFields({ ...fields, phrase: event.target.value })
          }
        />
      </div>
      <div className="field">
        <label htmlFor={`meaning-${answerId ?? "manual"}-${phrase}`}>
          What it means
        </label>
        <input
          id={`meaning-${answerId ?? "manual"}-${phrase}`}
          value={fields.meaning}
          onChange={(event) =>
            setFields({ ...fields, meaning: event.target.value })
          }
        />
      </div>
      <div className="field">
        <label htmlFor={`example-${answerId ?? "manual"}-${phrase}`}>
          Your example sentence
        </label>
        <textarea
          id={`example-${answerId ?? "manual"}-${phrase}`}
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
          onClick={save}
          disabled={stage === "saving" || !fields.phrase.trim()}
        >
          {stage === "saving" ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setStage("idle")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
