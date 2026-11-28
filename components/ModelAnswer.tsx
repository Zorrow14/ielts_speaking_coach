"use client";

/**
 * The optional "show me a band 7.5 version" button.
 *
 * Deliberately on demand: it costs a Gemini request, and more importantly the
 * learner must not see a model answer before they have spoken. This component
 * only ever renders under a result that already exists, and the route behind
 * it works from a saved answer id, so there is no path to an example answer
 * before the attempt.
 */
import { useState } from "react";
import Icon from "./Icon";

type State =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "error"; message: string }
  | { stage: "ready"; answer: string; changes: string[] };

export default function ModelAnswer({ answerId }: { answerId: string }) {
  const [state, setState] = useState<State>({ stage: "idle" });

  async function load() {
    setState({ stage: "loading" });
    try {
      const response = await fetch("/api/model-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setState({
          stage: "error",
          message: data.error ?? "Could not write an example answer.",
        });
        return;
      }
      setState({
        stage: "ready",
        answer: data.answer,
        changes: data.changes ?? [],
      });
    } catch {
      setState({
        stage: "error",
        message: "Could not reach the server. Check your connection.",
      });
    }
  }

  if (state.stage === "ready") {
    return (
      <section className="model-answer model-answer--ready" aria-label="Band 7.5 example">
        <p className="eyebrow">
          <Icon name="sparkle" />
          A band 7.5 version of your answer
        </p>
        <p className="muted">
          Your own ideas, said more precisely. This is an example of the level,
          not a script to memorise.
        </p>
        <blockquote className="model-answer__text">{state.answer}</blockquote>
        {state.changes.length > 0 ? (
          <>
            <h5>What changed</h5>
            <ul className="bullets">
              {state.changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="model-answer">
      <div className="model-answer__intro">
        <span className="model-answer__icon" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
        <div>
          <h4>See the same ideas at band 7.5</h4>
          <p className="muted">
            Your own answer, rewritten one level up. Uses one request from your
            daily allowance.
          </p>
        </div>
      </div>
      {state.stage === "error" ? (
        <p className="alert" role="alert">
          {state.message}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--quiet"
        onClick={load}
        disabled={state.stage === "loading"}
      >
        {state.stage === "loading"
          ? "Writing an example..."
          : "Show a Band 7.5 style example"}
      </button>
    </section>
  );
}
