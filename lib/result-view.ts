/**
 * One shape for a marked answer, built once and rendered everywhere.
 *
 * Both paths end up here: the live result straight after an evaluation, and a
 * row reopened from history. Keeping a single builder is what stops the two
 * screens drifting apart - in particular, it is what guarantees the estimate
 * labels and the pronunciation caveat appear in both.
 *
 * Plain serialisable data only: this crosses the server/client boundary.
 */
import type {
  Evaluation,
  MistakeCategory,
  PronunciationConfidence,
} from "./schemas";
import type { Scored } from "./scoring";

export type CriterionView = {
  key: "fluency" | "lexical" | "grammar" | "pronunciation";
  label: string;
  /** Formatted band, or null when it could not be judged. */
  band: string | null;
  evidence: string[];
  /** Extra facts shown under the criterion, e.g. the grammar error count. */
  details: string[];
};

export type MistakeView = {
  category: MistakeCategory;
  original: string;
  correction: string;
  explanation: string | null;
};

export type ResultView = {
  criteria: CriterionView[];
  overall: string;
  pronunciationConfidence: PronunciationConfidence;
  strengths: string[];
  nextSteps: string[];
  fillerNotes: string[];
  repetitionNotes: string[];
  guardrails: Array<{ code: string; message: string }>;
  promptVersion: string;
  model: string;
  mistakes: MistakeView[];
};

const CONFIDENCE_LABEL: Record<PronunciationConfidence, string> = {
  high: "clear recording",
  medium: "partly unclear recording",
  low: "recording too unclear to judge well",
  unavailable: "no audio to judge",
};

export function confidenceLabel(value: PronunciationConfidence): string {
  return CONFIDENCE_LABEL[value];
}

function band(value: number | null): string | null {
  return value === null ? null : value.toFixed(1);
}

/** Human-readable error-type list for the grammar criterion. */
function grammarDetails(evaluation: Evaluation): string[] {
  const details: string[] = [];
  const { sentences_total, sentences_with_errors, error_types } =
    evaluation.grammar;

  if (sentences_total > 0) {
    details.push(
      `${sentences_with_errors} of ${sentences_total} sentences contained an error`,
    );
  }
  if (error_types.length > 0) {
    details.push(`Main error types: ${error_types.join(", ")}`);
  }
  return details;
}

function pronunciationDetails(
  evaluation: Evaluation,
): string[] {
  const details = [
    `Confidence: ${evaluation.pronunciation.confidence} (${confidenceLabel(evaluation.pronunciation.confidence)})`,
  ];
  return details.concat(evaluation.pronunciation.issues);
}

/**
 * Builds the view from a model evaluation plus the bands computed in
 * `lib/scoring.ts`. The bands come from `scored`, not from `evaluation`,
 * because guardrails may have lowered one.
 */
export function buildResultView(input: {
  evaluation: Evaluation;
  scored: Scored;
  provenance: { promptVersion: string; model: string };
}): ResultView {
  const { evaluation, scored } = input;

  return {
    criteria: [
      {
        key: "fluency",
        label: "Fluency and Coherence",
        band: band(scored.bands.fluency),
        evidence: evaluation.fluency.evidence,
        details: [],
      },
      {
        key: "lexical",
        label: "Lexical Resource",
        band: band(scored.bands.lexical),
        evidence: evaluation.lexical.evidence,
        details: [],
      },
      {
        key: "grammar",
        label: "Grammatical Range and Accuracy",
        band: band(scored.bands.grammar),
        evidence: evaluation.grammar.evidence,
        details: grammarDetails(evaluation),
      },
      {
        key: "pronunciation",
        label: "Pronunciation",
        band: band(scored.bands.pronunciation),
        evidence: evaluation.pronunciation.evidence,
        details: pronunciationDetails(evaluation),
      },
    ],
    overall: scored.overall.toFixed(1),
    pronunciationConfidence: evaluation.pronunciation.confidence,
    strengths: evaluation.strengths,
    nextSteps: evaluation.next_steps,
    fillerNotes: evaluation.filler_notes,
    repetitionNotes: evaluation.repetition_notes,
    guardrails: scored.guardrails,
    promptVersion: input.provenance.promptVersion,
    model: input.provenance.model,
    mistakes: evaluation.mistakes.map((mistake) => ({
      category: mistake.category,
      original: mistake.original,
      correction: mistake.correction,
      explanation: mistake.explanation,
    })),
  };
}
