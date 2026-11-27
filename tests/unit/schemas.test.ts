/**
 * zod is the real gate on model output and on request bodies. These tests pin
 * the rejections that matter - especially the evidence rule, which is the only
 * thing stopping an unjustified band from being stored.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluationSchema,
  modelAnswerRequestSchema,
  part2CueCardSchema,
  questionRequestSchema,
  vocabCreateSchema,
  vocabReviewSchema,
  vocabUpdateSchema,
} from "../../lib/schemas";

/** A model response that should pass, as a base for the negative cases. */
function validEvaluation() {
  return {
    transcript: "A transcript with plenty of words in it for the guardrail.",
    fluency: { band: 6, evidence: ["because, um, because"] },
    lexical: { band: 6, evidence: ["very nice"] },
    grammar: {
      band: 5.5,
      evidence: ["there is many shop"],
      sentences_total: 8,
      sentences_with_errors: 5,
      error_types: ["articles", "countability"],
    },
    pronunciation: {
      band: 6,
      confidence: "high",
      evidence: ["comfortable"],
      issues: ["stress on the wrong syllable"],
    },
    filler_notes: ["um, about six times"],
    repetition_notes: ["\"mostly\" four times"],
    strengths: ["Answered the question directly"],
    next_steps: ["one", "two", "three"],
    mistakes: [
      {
        category: "article",
        original: "a opportunity",
        correction: "an opportunity",
        explanation: "Use an before a vowel sound.",
      },
    ],
  };
}

describe("evaluationSchema", () => {
  it("accepts a well-formed evaluation", () => {
    assert.equal(evaluationSchema.safeParse(validEvaluation()).success, true);
  });

  it("rejects a scored criterion with no evidence", () => {
    const bad = validEvaluation();
    bad.fluency.evidence = [];
    const result = evaluationSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  it("allows an unscored criterion to have no evidence", () => {
    const value = validEvaluation();
    // No audio: null band, unavailable confidence, nothing quoted.
    value.pronunciation = {
      band: null,
      confidence: "unavailable",
      evidence: [],
      issues: [],
    } as never;
    assert.equal(evaluationSchema.safeParse(value).success, true);
  });

  it("rejects a pronunciation band with unavailable confidence", () => {
    const bad = validEvaluation();
    bad.pronunciation.confidence = "unavailable";
    assert.equal(evaluationSchema.safeParse(bad).success, false);
  });

  it("rejects bands that are not half steps", () => {
    for (const band of [6.3, 6.25, 5.7]) {
      const bad = validEvaluation();
      bad.fluency.band = band;
      assert.equal(
        evaluationSchema.safeParse(bad).success,
        false,
        `${band} should be rejected`,
      );
    }
  });

  it("rejects bands outside 1 to 9", () => {
    for (const band of [0, 0.5, 9.5, 10, -1]) {
      const bad = validEvaluation();
      bad.fluency.band = band;
      assert.equal(
        evaluationSchema.safeParse(bad).success,
        false,
        `${band} should be rejected`,
      );
    }
  });

  it("requires exactly three next steps when there is a transcript", () => {
    for (const steps of [[], ["one"], ["one", "two"], ["a", "b", "c", "d"]]) {
      const bad = validEvaluation();
      bad.next_steps = steps;
      assert.equal(evaluationSchema.safeParse(bad).success, false);
    }
  });

  it("allows no next steps when the transcript is empty", () => {
    const value = validEvaluation();
    value.transcript = "";
    value.next_steps = [];
    value.fluency = { band: null, evidence: [] } as never;
    value.lexical = { band: null, evidence: [] } as never;
    value.grammar = {
      band: null,
      evidence: [],
      sentences_total: 0,
      sentences_with_errors: 0,
      error_types: [],
    } as never;
    value.pronunciation = {
      band: null,
      confidence: "unavailable",
      evidence: [],
      issues: [],
    } as never;
    value.mistakes = [];
    assert.equal(evaluationSchema.safeParse(value).success, true);
  });

  it("rejects an unknown mistake category", () => {
    const bad = validEvaluation();
    bad.mistakes[0].category = "grammar"; // a phase 2 value, removed in phase 3
    assert.equal(evaluationSchema.safeParse(bad).success, false);
  });

  it("rejects more errored sentences than total sentences", () => {
    const bad = validEvaluation();
    bad.grammar.sentences_total = 3;
    bad.grammar.sentences_with_errors = 9;
    assert.equal(evaluationSchema.safeParse(bad).success, false);
  });

  it("rejects more than three evidence quotes", () => {
    const bad = validEvaluation();
    bad.fluency.evidence = ["a", "b", "c", "d"];
    assert.equal(evaluationSchema.safeParse(bad).success, false);
  });
});

describe("request schemas", () => {
  it("accepts a valid question request", () => {
    assert.equal(questionRequestSchema.safeParse({ part: 2 }).success, true);
  });

  it("rejects a part outside 1 to 3", () => {
    for (const part of [0, 4, "2", null, undefined, 1.5]) {
      assert.equal(
        questionRequestSchema.safeParse({ part }).success,
        false,
        `part ${String(part)} should be rejected`,
      );
    }
  });

  it("bounds the previous transcript it will echo back into a prompt", () => {
    assert.equal(
      questionRequestSchema.safeParse({
        part: 3,
        previousTranscript: "x".repeat(20001),
      }).success,
      false,
    );
  });

  it("requires a uuid for a model answer", () => {
    assert.equal(
      modelAnswerRequestSchema.safeParse({ answerId: "not-a-uuid" }).success,
      false,
    );
    assert.equal(
      modelAnswerRequestSchema.safeParse({
        answerId: "3f1d9b2e-5c4a-4e8b-9c7a-2b1e4d6f8a90",
      }).success,
      true,
    );
  });

  it("requires exactly four cue card bullets", () => {
    const base = { topic: "Books", prompt: "Describe a book." };
    for (const bullets of [[], ["a"], ["a", "b", "c"], ["a", "b", "c", "d", "e"]]) {
      assert.equal(
        part2CueCardSchema.safeParse({ ...base, bullets }).success,
        false,
      );
    }
    assert.equal(
      part2CueCardSchema.safeParse({ ...base, bullets: ["a", "b", "c", "d"] })
        .success,
      true,
    );
  });
});

describe("vocab schemas", () => {
  it("requires a phrase", () => {
    assert.equal(vocabCreateSchema.safeParse({ phrase: "" }).success, false);
    assert.equal(vocabCreateSchema.safeParse({}).success, false);
    assert.equal(
      vocabCreateSchema.safeParse({ phrase: "on the whole" }).success,
      true,
    );
  });

  it("bounds the phrase length", () => {
    assert.equal(
      vocabCreateSchema.safeParse({ phrase: "x".repeat(201) }).success,
      false,
    );
  });

  it("rejects an empty update", () => {
    assert.equal(vocabUpdateSchema.safeParse({}).success, false);
  });

  it("accepts only the two review verdicts", () => {
    assert.equal(vocabReviewSchema.safeParse({ result: "got_it" }).success, true);
    assert.equal(vocabReviewSchema.safeParse({ result: "again" }).success, true);
    assert.equal(vocabReviewSchema.safeParse({ result: "maybe" }).success, false);
  });
});
