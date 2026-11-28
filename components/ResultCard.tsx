/**
 * Shows one marked answer. Used live after an answer and again on the history
 * pages, so it takes a plain ResultView and works in a server component: no
 * hooks, and the expandable evidence is native <details>, which needs no
 * JavaScript and is keyboard-accessible for free.
 *
 * Every score carries the full estimate label, and Pronunciation is shown in
 * its own box as an indicator with its confidence - never with a band bar,
 * so it cannot be read as a fourth band. That wording is a hard rule, not
 * decoration, and tests/structure/result-labels.test.ts enforces it.
 *
 * The reveal (bands rising in, bars filling) is CSS only, staggered with a
 * --i index. Bands appear; they do not count up, because a number ticking
 * from 0.0 to 6.5 implies a precision an estimate does not have. Under
 * reduced motion everything is simply there.
 */
import type { CSSProperties } from "react";
import Icon from "./Icon";
import ModelAnswer from "./ModelAnswer";
import SaveToNotebook from "./SaveToNotebook";
import { formatClock } from "@/lib/audio";
import {
  confidenceLabel,
  type CriterionView,
  type MistakeView,
  type ResultView,
} from "@/lib/result-view";
import type { MistakeCategory, PronunciationConfidence } from "@/lib/schemas";

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

const ESTIMATE = "AI estimate, not an official IELTS band";

const CONFIDENCE_TONE: Record<PronunciationConfidence, string> = {
  high: "badge--success",
  medium: "badge--accent",
  low: "badge--warning",
  unavailable: "",
};

/** The 1-9 band as a 0-1 fill for the bar. */
function fillFor(band: string | null): number {
  if (band === null) return 0;
  const value = Number(band);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 9)) : 0;
}

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
  const bands = view?.criteria.filter((c) => c.key !== "pronunciation") ?? [];
  const pronunciation = view?.criteria.find((c) => c.key === "pronunciation");

  return (
    <article className="result">
      <header className="result__head">
        <p className="eyebrow">The question</p>
        <h3 className="result__question">{question}</h3>
      </header>

      {view ? (
        <>
          <section className="score-hero" aria-label="Overall estimate">
            <div className="score-hero__main">
              <p className="score-hero__label">Overall</p>
              <p className="score-hero__band">{view.overall}</p>
              {/* Directly beneath the number, never beside it. */}
              <p className="estimate-note">{ESTIMATE}</p>
            </div>
            <dl className="score-hero__facts">
              <div>
                <dt>Words</dt>
                <dd>{wordCount ?? 0}</dd>
              </div>
              {durationSec ? (
                <div>
                  <dt>Length</dt>
                  <dd>{formatClock(durationSec * 1000)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Corrections</dt>
                <dd>{view.mistakes.length}</dd>
              </div>
            </dl>
          </section>

          {view.guardrails.length > 0 ? (
            <ul className="guardrails" role="list">
              {view.guardrails.map((note) => (
                <li key={note.code} className="alert alert--soft">
                  {note.message}
                </li>
              ))}
            </ul>
          ) : null}

          <section className="criteria" aria-label="The four criteria">
            {bands.map((criterion, index) => (
              <Criterion key={criterion.key} criterion={criterion} index={index} />
            ))}
            {pronunciation ? (
              <Pronunciation
                criterion={pronunciation}
                confidence={view.pronunciationConfidence}
                index={bands.length}
              />
            ) : null}
          </section>

          {view.nextSteps.length > 0 ? (
            <section className="result__section">
              <h4>Next steps, highest impact first</h4>
              <ol className="next-steps">
                {view.nextSteps.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {view.mistakes.length > 0 ? (
            <section className="result__section">
              <h4>Mistakes and corrections</h4>
              <ul className="mistake-cards" role="list">
                {view.mistakes.map((mistake, index) => (
                  <Mistake key={index} mistake={mistake} answerId={answerId} />
                ))}
              </ul>
            </section>
          ) : null}

          {view.strengths.length > 0 ? (
            <section className="result__section">
              <h4>What worked</h4>
              <ul className="bullets">
                {view.strengths.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {view.fillerNotes.length > 0 || view.repetitionNotes.length > 0 ? (
            <section className="result__section">
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
        </>
      ) : (
        <p className="muted">This answer has no saved marking.</p>
      )}

      <details className="disclosure result__transcript" open>
        <summary>
          <span>What you said</span>
          <span className="disclosure__meta">
            {wordCount ?? 0} words
            {durationSec ? ` in ${durationSec} seconds` : ""}
          </span>
          <Icon name="chevronDown" className="disclosure__chevron" />
        </summary>
        <p className="transcript">{transcript || "(no speech detected)"}</p>
      </details>

      {view ? (
        <>
          {answerId ? <ModelAnswer answerId={answerId} /> : null}

          <p className="provenance">
            Marked by {view.model}, prompt {view.promptVersion}. All scores are
            AI estimates, not official IELTS bands.
          </p>
        </>
      ) : null}
    </article>
  );
}

function Evidence({ quotes }: { quotes: string[] }) {
  if (quotes.length === 0) {
    return <p className="criterion__none">No evidence quoted for this criterion.</p>;
  }
  return (
    <details className="disclosure disclosure--quiet">
      <summary>
        <span>Evidence from your answer</span>
        <span className="disclosure__count">{quotes.length}</span>
        <Icon name="chevronDown" className="disclosure__chevron" />
      </summary>
      <ul className="evidence" role="list">
        {quotes.map((quote, index) => (
          <li key={index}>
            <q>{quote}</q>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Criterion({
  criterion,
  index,
}: {
  criterion: CriterionView;
  index: number;
}) {
  return (
    <div className="criterion" style={{ "--i": index } as CSSProperties}>
      <div className="criterion__head">
        <h4 className="criterion__label">{criterion.label}</h4>
        <p className="criterion__band">{criterion.band ?? "n/a"}</p>
      </div>
      <div className="band-bar" aria-hidden="true">
        <span
          className="band-bar__fill"
          style={{ "--fill": fillFor(criterion.band).toFixed(3) } as CSSProperties}
        />
      </div>
      <p className="estimate-note">{ESTIMATE}</p>

      {criterion.details.length > 0 ? (
        <ul className="criterion__details" role="list">
          {criterion.details.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      ) : null}

      <Evidence quotes={criterion.evidence} />
    </div>
  );
}

/**
 * Its own box, deliberately unlike the three bands: no bar, the value set
 * smaller, an "indicator, not a band" badge and the confidence beside it.
 * Judging pronunciation from one phone recording is the weakest thing this
 * app does, and the layout should say so before the words do.
 */
function Pronunciation({
  criterion,
  confidence,
  index,
}: {
  criterion: CriterionView;
  confidence: PronunciationConfidence;
  index: number;
}) {
  // The confidence line is shown as a badge, so drop it from the details.
  const issues = criterion.details.filter((d) => !d.startsWith("Confidence:"));

  return (
    <div className="indicator" style={{ "--i": index } as CSSProperties}>
      <div className="criterion__head">
        <h4 className="criterion__label">{criterion.label}</h4>
        <span className="badge">Indicator only, not a band</span>
      </div>

      <p className="indicator__value">
        <span className="indicator__number">{criterion.band ?? "n/a"}</span>
        <span className={`badge ${CONFIDENCE_TONE[confidence]}`}>
          Confidence: {confidence}
        </span>
        <span className="indicator__why">{confidenceLabel(confidence)}</span>
      </p>
      <p className="estimate-note">
        {ESTIMATE} &mdash; the least reliable of the four
      </p>

      {issues.length > 0 ? (
        <ul className="criterion__details" role="list">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <Evidence quotes={criterion.evidence} />
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
    <li className="mistake-card">
      <span className="badge">{CATEGORY_LABEL[mistake.category]}</span>
      <p className="mistake-card__line mistake-card__line--was">
        <Icon name="close" />
        <span>
          <span className="visually-hidden">You said: </span>
          <s>{mistake.original}</s>
        </span>
      </p>
      <p className="mistake-card__line mistake-card__line--fix">
        <Icon name="check" />
        <span>
          <span className="visually-hidden">Better: </span>
          {mistake.correction}
        </span>
      </p>
      {mistake.explanation ? (
        <p className="mistake-card__why">{mistake.explanation}</p>
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
