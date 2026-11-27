/**
 * Scoring arithmetic and the deterministic guardrails from phase 3.
 *
 * These are the highest-value tests in the suite: the overall band is the
 * number the learner reads, and it is computed here rather than by the model
 * precisely so it can be pinned by tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_TRANSCRIPT_WORDS,
  PART2_MIN_DURATION_SEC,
  PART2_SHORT_FLUENCY_CAP,
  countWords,
  roundToHalfBand,
  score,
  tooShortToScore,
} from "../../lib/scoring";
import type { Evaluation } from "../../lib/schemas";

/** A valid evaluation, with only the fields a test cares about overridden. */
function evaluation(overrides: {
  fluency?: number | null;
  lexical?: number | null;
  grammar?: number | null;
  pronunciation?: number | null;
  transcript?: string;
}): Evaluation {
  const criterion = (band: number | null) => ({
    band,
    evidence: band === null ? [] : ["a quoted extract"],
  });

  // `?? 6` would collapse an explicit null to 6, which is exactly the case
  // some of these tests are about, so each field checks for undefined.
  const or6 = (value: number | null | undefined) =>
    value === undefined ? 6 : value;

  return {
    transcript:
      overrides.transcript ??
      "This is a long enough transcript to clear the minimum word guardrail without any trouble at all.",
    fluency: criterion(or6(overrides.fluency)),
    lexical: criterion(or6(overrides.lexical)),
    grammar: {
      ...criterion(or6(overrides.grammar)),
      sentences_total: 5,
      sentences_with_errors: 2,
      error_types: ["articles"],
    },
    pronunciation: {
      band: overrides.pronunciation === undefined ? 6 : overrides.pronunciation,
      confidence:
        overrides.pronunciation === null ? "unavailable" : ("high" as const),
      evidence: overrides.pronunciation === null ? [] : ["a word"],
      issues: [],
    },
    filler_notes: [],
    repetition_notes: [],
    strengths: [],
    next_steps: ["one", "two", "three"],
    mistakes: [],
  };
}

describe("roundToHalfBand", () => {
  it("applies the IELTS rounding rule", () => {
    // Mean exactly on a half band.
    assert.equal(roundToHalfBand([5, 6, 6, 7]), 6);
    // .25 rounds UP to the next half band.
    assert.equal(roundToHalfBand([6, 6, 6, 7]), 6.5);
    // .75 rounds UP to the next whole band.
    assert.equal(roundToHalfBand([6, 7, 7, 7]), 7);
    assert.equal(roundToHalfBand([5, 6, 6, 6]), 6);
    // .125 and .375 go to the nearest half.
    assert.equal(roundToHalfBand([5, 5, 5, 5.5]), 5);
    assert.equal(roundToHalfBand([5, 5, 5.5, 6]), 5.5);
  });

  it("works on three criteria, for an answer with no usable audio", () => {
    assert.equal(roundToHalfBand([6, 6, 7]), 6.5);
    assert.equal(roundToHalfBand([5, 5, 6]), 5.5);
  });

  it("is exact rather than floating point", () => {
    // 6.25 must not arrive as 6.2499999 and round the wrong way.
    for (let i = 0; i < 200; i += 1) {
      const value = roundToHalfBand([6, 6, 6, 7]);
      assert.equal(value, 6.5);
    }
  });

  it("refuses an empty list rather than returning NaN", () => {
    assert.throws(() => roundToHalfBand([]));
  });
});

describe("tooShortToScore", () => {
  it("refuses a transcript under the minimum", () => {
    const result = tooShortToScore("Yes I like it very much.");
    assert.ok(result, "a six-word answer should be refused");
    assert.equal(result.words, 6);
    assert.match(result.message, /not enough speech/i);
  });

  it("accepts a transcript at the minimum", () => {
    const words = Array.from(
      { length: MIN_TRANSCRIPT_WORDS },
      (_, i) => `word${i}`,
    ).join(" ");
    assert.equal(tooShortToScore(words), null);
  });

  it("treats whitespace-only as zero words", () => {
    const result = tooShortToScore("   \n  ");
    assert.ok(result);
    assert.equal(result.words, 0);
  });
});

describe("countWords", () => {
  it("collapses runs of whitespace", () => {
    assert.equal(countWords("one   two\n\nthree"), 3);
    assert.equal(countWords(""), 0);
  });
});

describe("score", () => {
  it("computes the overall from the four criteria", () => {
    const result = score({
      evaluation: evaluation({ fluency: 6, lexical: 6, grammar: 6, pronunciation: 7 }),
      part: 1,
      durationSec: 40,
    });
    assert.ok(result);
    assert.equal(result.overall, 6.5);
    assert.equal(result.guardrails.length, 0);
  });

  it("drops pronunciation from the average when it is null", () => {
    const result = score({
      evaluation: evaluation({
        fluency: 6,
        lexical: 6,
        grammar: 7,
        pronunciation: null,
      }),
      part: 1,
      durationSec: 40,
    });
    assert.ok(result);
    assert.equal(result.bands.pronunciation, null);
    // Average of three, not four with a zero.
    assert.equal(result.overall, 6.5);
  });

  it("caps Part 2 fluency when the long turn was too short", () => {
    const result = score({
      evaluation: evaluation({ fluency: 7.5, lexical: 7, grammar: 7, pronunciation: 7 }),
      part: 2,
      durationSec: PART2_MIN_DURATION_SEC - 1,
    });
    assert.ok(result);
    assert.equal(result.bands.fluency, PART2_SHORT_FLUENCY_CAP);
    assert.equal(result.guardrails.length, 1);
    assert.equal(result.guardrails[0].code, "part2_too_short");
    assert.match(result.guardrails[0].message, /too short for Part 2/i);
  });

  it("does not cap a Part 2 that reached the minimum", () => {
    const result = score({
      evaluation: evaluation({ fluency: 7.5 }),
      part: 2,
      durationSec: PART2_MIN_DURATION_SEC,
    });
    assert.ok(result);
    assert.equal(result.bands.fluency, 7.5);
    assert.equal(result.guardrails.length, 0);
  });

  it("does not cap Part 1 or Part 3, which are not long turns", () => {
    for (const part of [1, 3]) {
      const result = score({
        evaluation: evaluation({ fluency: 7.5 }),
        part,
        durationSec: 20,
      });
      assert.ok(result);
      assert.equal(result.bands.fluency, 7.5);
    }
  });

  it("never raises a fluency band that is already below the cap", () => {
    const result = score({
      evaluation: evaluation({ fluency: 5 }),
      part: 2,
      durationSec: 10,
    });
    assert.ok(result);
    assert.equal(result.bands.fluency, 5);
  });

  it("skips the cap when the duration is unknown", () => {
    // durationSec 0 means "not reported", not "a zero-second answer".
    const result = score({
      evaluation: evaluation({ fluency: 7.5 }),
      part: 2,
      durationSec: 0,
    });
    assert.ok(result);
    assert.equal(result.bands.fluency, 7.5);
  });

  it("returns null when the model declined to score a core criterion", () => {
    assert.equal(
      score({
        evaluation: evaluation({ fluency: null }),
        part: 1,
        durationSec: 30,
      }),
      null,
    );
  });
});
