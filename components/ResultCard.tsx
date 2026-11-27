/**
 * Shows one marked answer. Used live after an answer and again on the history
 * page, so it takes a plain ResultView and works in a server component.
 *
 * Every score carries the estimate label, and Pronunciation is always marked
 * as an indicator with its confidence. That wording is a hard rule, not
 * decoration.
 *
 * Evidence quotes sit under each criterion on purpose: a band with the words
 * that earned it is checkable, and the learner can see what to fix.
 */
import ModelAnswer from "./ModelAnswer";
import SaveToNotebook from "./SaveToNotebook";
import type { CriterionView, MistakeView, ResultView } from "@/lib/result-view";
import type { MistakeCategory } from "@/lib/schemas";

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

export default function ResultCard({
  question,
  transcript,
  durationSec,
  wordCount,
  view,
  answerId,
}: {
  question: string;
  transcript: string;
  durationSec: number | null;
  wordCount: number | null;
  view: ResultView | null;
  /** When present, the band 7.5 example can be requested for this answer. */
  answerId?: string;
}) {
  return (
    <article className="card result">
      <h3 className="result__question">{question}</h3>

      {view ? (
        <>
          <p className="estimate-note">
            AI estimate, not an official IELTS band.
          </p>

          {view.guardrails.length > 0 ? (
            <ul className="guardrails">
              {view.guardrails.map((note) => (
                <li key={note.code} className="alert alert--soft">
                  {note.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="overall">
            Overall estimate <strong>{view.overall}</strong>
            <span className="muted">
              {" "}
              &mdash; AI estimate, not an official IELTS band
            </span>
          </p>

          <section className="criteria">
            {view.criteria.map((criterion) => (
              <Criterion key={criterion.key} criterion={criterion} />
            ))}
          </section>
        </>
      ) : (
        <p className="muted">This answer has no saved marking.</p>
      )}

      <section>
        <h4>Transcript</h4>
        <p className="transcript">{transcript || "(no speech detected)"}</p>
        <p className="muted">
          {wordCount ?? 0} words
          {durationSec ? ` in ${durationSec} seconds` : ""}
        </p>
      </section>

      {view ? (
        <>
          {view.mistakes.length > 0 ? (
            <section>
              <h4>Mistakes and corrections</h4>
              <ul className="mistakes">
                {view.mistakes.map((mistake, index) => (
                  <Mistake key={index} mistake={mistake} answerId={answerId} />
                ))}
              </ul>
            </section>
          ) : null}

          {view.fillerNotes.length > 0 || view.repetitionNotes.length > 0 ? (
            <section>
              <h4>Fillers and repetition</h4>
              <ul className="bullets">
                {view.fillerNotes.map((note, index) => (
                  <li key={`filler-${index}`}>{note}</li>
                ))}
                {view.repetitionNotes.map((note, index) => (
                  <li key={`repeat-${index}`}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {view.strengths.length > 0 ? (
            <section>
              <h4>What worked</h4>
              <ul className="bullets">
                {view.strengths.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {view.nextSteps.length > 0 ? (
            <section>
              <h4>Next steps, highest impact first</h4>
              <ol className="bullets bullets--ranked">
                {view.nextSteps.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {answerId ? <ModelAnswer answerId={answerId} /> : null}

          <p className="muted provenance">
            Marked by {view.model}, prompt {view.promptVersion}. All scores are
            AI estimates, not official IELTS bands.
          </p>
        </>
      ) : null}
    </article>
  );
}

function Criterion({ criterion }: { criterion: CriterionView }) {
  const isPronunciation = criterion.key === "pronunciation";

  return (
    <div className="criterion">
      <div className="criterion__head">
        <span className="criterion__band">{criterion.band ?? "n/a"}</span>
        <span className="criterion__label">
          {criterion.label}
          {isPronunciation ? (
            <span className="muted"> (indicator only, not a band)</span>
          ) : null}
        </span>
      </div>

      <p className="muted criterion__estimate">
        AI estimate, not an official IELTS band
        {isPronunciation ? " — the least reliable of the four" : ""}
      </p>

      {criterion.evidence.length > 0 ? (
        <ul className="evidence">
          {criterion.evidence.map((quote, index) => (
            <li key={index}>
              <q>{quote}</q>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No evidence quoted for this criterion.</p>
      )}

      {criterion.details.length > 0 ? (
        <ul className="bullets bullets--tight">
          {criterion.details.map((detail, index) => (
            <li key={index} className="muted">
              {detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Mistake({
  mistake,
  answerId,
}: {
  mistake: MistakeView;
  answerId?: string;
}) {
  return (
    <li>
      <span className="tag">{CATEGORY_LABEL[mistake.category]}</span>
      <p>
        <s>{mistake.original}</s> &rarr; <strong>{mistake.correction}</strong>
      </p>
      {mistake.explanation ? (
        <p className="muted">{mistake.explanation}</p>
      ) : null}
      {/* The correction is the phrase worth keeping, prefilled and editable. */}
      <SaveToNotebook
        phrase={mistake.correction}
        meaning={mistake.explanation}
        example={mistake.correction}
        answerId={answerId}
        label="Save this phrase"
      />
    </li>
  );
}
