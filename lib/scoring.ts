/**
 * Scoring arithmetic and deterministic guardrails.
 *
 * Everything in here is deliberately OUTSIDE the model. Two reasons:
 *
 * - Arithmetic. Language models average and round unreliably, and a wrong
 *   overall band is the most visible error the app can make. The model returns
 *   four criterion bands; this file turns them into an overall.
 * - Floors the model cannot talk itself out of. A 40-second Part 2 is short
 *   whatever the prose says about it, so the cap is applied here rather than
 *   asked for in the prompt.
 *
 * The constants at the top are the tuning surface. Change them here; nothing
 * else hard-codes these numbers.
 */
import type { Evaluation } from "./schemas";

// --- Tuning constants ------------------------------------------------------

/** A Part 2 long turn shorter than this has not been sustained. */
export const PART2_MIN_DURATION_SEC = 60;

/** Ceiling on Fluency and Coherence for a Part 2 that fell short of the above. */
export const PART2_SHORT_FLUENCY_CAP = 5.5;

/** Below this many words there is not enough speech to score fairly. */
export const MIN_TRANSCRIPT_WORDS = 15;

/** Sampling temperature for evaluation. Low, because scores should be stable. */
export const EVALUATION_TEMPERATURE = 0.1;

/** Fixed seed, so repeated evaluations of identical input agree where possible. */
export const EVALUATION_SEED = 7;

/** Model answers are generative, so they get a little more room. */
export const MODEL_ANSWER_TEMPERATURE = 0.6;

// --- Word counting ---------------------------------------------------------

export function countWords(transcript: string): number {
  const trimmed = transcript.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Why an answer was refused scoring, or null when it is long enough. */
export function tooShortToScore(
  transcript: string,
): { words: number; message: string } | null {
  const words = countWords(transcript);
  if (words >= MIN_TRANSCRIPT_WORDS) return null;
  return {
    words,
    message: `That answer was only ${words} ${words === 1 ? "word" : "words"} long. Under ${MIN_TRANSCRIPT_WORDS} words there is not enough speech to score fairly, so it has not been marked. Give a fuller answer and try again.`,
  };
}

// --- Overall band ----------------------------------------------------------

/**
 * The IELTS rounding rule: average the criteria, then round to the nearest
 * half band, with .25 going up to .5 and .75 going up to the next whole band.
 *
 * Worked in half-band integer units rather than floats, so 6.25 cannot arrive
 * as 6.249999 and round the wrong way.
 */
export function roundToHalfBand(bands: number[]): number {
  if (bands.length === 0) throw new Error("No bands to average.");
  const halfUnits = bands.reduce((sum, value) => sum + Math.round(value * 2), 0);
  const n = bands.length;
  // floor(sum/n + 1/2) in exact integer arithmetic.
  return Math.floor((2 * halfUnits + n) / (2 * n)) / 2;
}

export type GuardrailNote = {
  /** Stable id so the UI and phase 4 can recognise it without string matching. */
  code: "part2_too_short";
  message: string;
};

export type Bands = {
  fluency: number;
  lexical: number;
  grammar: number;
  /** Null when there was no audio, or the audio could not be judged. */
  pronunciation: number | null;
};

export type Scored = {
  bands: Bands;
  /**
   * Computed here, never taken from the model. Includes pronunciation when it
   * is available, because it is one of the four IELTS criteria - the UI flags
   * it as the least reliable rather than dropping it.
   */
  overall: number;
  guardrails: GuardrailNote[];
};

/**
 * Turns the model's four criterion bands into final bands plus an overall,
 * applying the deterministic caps on the way.
 *
 * Returns null when the model declined to score the core criteria at all,
 * which the caller treats as an unusable evaluation.
 */
export function score(input: {
  evaluation: Evaluation;
  part: number;
  durationSec: number;
}): Scored | null {
  const { evaluation } = input;
  const { fluency, lexical, grammar, pronunciation } = evaluation;

  if (fluency.band === null || lexical.band === null || grammar.band === null) {
    return null;
  }

  const guardrails: GuardrailNote[] = [];
  let fluencyBand = fluency.band;

  // A long turn that was not sustained cannot score well on the criterion that
  // measures sustaining it, whatever the model concluded.
  if (
    input.part === 2 &&
    input.durationSec > 0 &&
    input.durationSec < PART2_MIN_DURATION_SEC &&
    fluencyBand > PART2_SHORT_FLUENCY_CAP
  ) {
    fluencyBand = PART2_SHORT_FLUENCY_CAP;
    guardrails.push({
      code: "part2_too_short",
      message: `Answer too short for Part 2: ${input.durationSec} seconds. A Part 2 long turn should run about 1.5 to 2 minutes, so Fluency and Coherence is capped at ${PART2_SHORT_FLUENCY_CAP.toFixed(1)}.`,
    });
  }

  const bands: Bands = {
    fluency: fluencyBand,
    lexical: lexical.band,
    grammar: grammar.band,
    pronunciation: pronunciation.band,
  };

  const forAverage = [bands.fluency, bands.lexical, bands.grammar];
  if (bands.pronunciation !== null) forAverage.push(bands.pronunciation);

  return { bands, overall: roundToHalfBand(forAverage), guardrails };
}
