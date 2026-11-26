/**
 * Shows one marked answer. Used live after an answer and again on the history
 * page, so it takes plain strings and works in a server component.
 *
 * Every score carries the estimate label, and Pronunciation is always marked
 * as an indicator. That wording is a hard rule, not decoration.
 */
export type ResultScores = {
  fluency: string;
  lexical: string;
  grammar: string;
  pronunciationEst: string;
  overall: string;
  strengths: string[];
  nextSteps: string[];
};

export type ResultMistake = {
  category: "grammar" | "vocab" | "fluency";
  original: string;
  correction: string;
  explanation: string | null;
};

const CATEGORY_LABEL: Record<ResultMistake["category"], string> = {
  grammar: "Grammar",
  vocab: "Vocabulary",
  fluency: "Fluency",
};

export default function ResultCard({
  question,
  transcript,
  durationSec,
  wordCount,
  scores,
  mistakes,
}: {
  question: string;
  transcript: string;
  durationSec: number | null;
  wordCount: number | null;
  scores: ResultScores | null;
  mistakes: ResultMistake[];
}) {
  return (
    <article className="card result">
      <h3 className="result__question">{question}</h3>

      {scores ? (
        <>
          <p className="estimate-note">
            AI estimate, not an official IELTS band.
          </p>

          <div className="scores">
            <Score label="Fluency and Coherence" value={scores.fluency} />
            <Score label="Lexical Resource" value={scores.lexical} />
            <Score label="Grammatical Range and Accuracy" value={scores.grammar} />
            <Score
              label="Pronunciation"
              value={scores.pronunciationEst}
              note="indicator only, not a band"
            />
          </div>

          <p className="overall">
            Overall estimate <strong>{scores.overall}</strong>
            <span className="muted"> &mdash; AI estimate, not an official IELTS band</span>
          </p>
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

      {mistakes.length > 0 ? (
        <section>
          <h4>Mistakes and corrections</h4>
          <ul className="mistakes">
            {mistakes.map((mistake, index) => (
              <li key={index}>
                <span className="tag">{CATEGORY_LABEL[mistake.category]}</span>
                <p>
                  <s>{mistake.original}</s> &rarr; <strong>{mistake.correction}</strong>
                </p>
                {mistake.explanation ? (
                  <p className="muted">{mistake.explanation}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scores && scores.strengths.length > 0 ? (
        <section>
          <h4>What worked</h4>
          <ul className="bullets">
            {scores.strengths.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {scores && scores.nextSteps.length > 0 ? (
        <section>
          <h4>Next steps</h4>
          <ul className="bullets">
            {scores.nextSteps.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function Score({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="scores__item">
      <span className="scores__value">{value}</span>
      <span className="scores__label">
        {label}
        {note ? <span className="muted"> ({note})</span> : null}
      </span>
    </div>
  );
}
