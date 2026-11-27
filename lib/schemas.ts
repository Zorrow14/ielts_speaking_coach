/**
 * Shared contracts between Gemini, the API routes and the UI.
 *
 * Two representations of each payload, on purpose:
 *
 * - `*JsonSchema` is sent to Gemini to constrain generation. Gemini supports
 *   only a subset of JSON Schema and silently ignores `minLength`,
 *   `maxLength`, `uniqueItems` and friends, so these stay deliberately plain.
 * - the zod schemas are the real gate. They run on the response and enforce
 *   what Gemini will not, such as bands being half steps inside 1-9 and every
 *   scored criterion carrying quoted evidence.
 *
 * Phase 3 note: the model no longer returns `overall`. It is computed in
 * `lib/scoring.ts` from the four criterion bands, because the rounding rule is
 * arithmetic and models get arithmetic wrong.
 */
import * as z from "zod";

export const PARTS = [1, 2, 3] as const;
export type Part = (typeof PARTS)[number];

/**
 * IELTS bands move in half steps. The floor is 1, not 0: band 0 means "did not
 * attempt", which this app represents with a null band instead.
 */
const band = z
  .number()
  .min(1)
  .max(9)
  .refine((value) => Number.isInteger(value * 2), {
    message: "Band must be a whole or half number between 1 and 9",
  });

/** Quotes are short extracts, not paragraphs. */
const quote = z.string().min(1).max(400);

// --- Questions -------------------------------------------------------------

export const part1QuestionSchema = z.object({
  topic: z.string().min(1),
  question: z.string().min(1),
});

export const part2CueCardSchema = z.object({
  topic: z.string().min(1),
  prompt: z.string().min(1),
  bullets: z.array(z.string().min(1)).length(4),
});

export const part3QuestionSchema = z.object({
  topic: z.string().min(1),
  question: z.string().min(1),
});

export type Part1Question = z.infer<typeof part1QuestionSchema>;
export type Part2CueCard = z.infer<typeof part2CueCardSchema>;
export type Part3Question = z.infer<typeof part3QuestionSchema>;

export type QuestionResponse =
  | ({ part: 1 } & Part1Question)
  | ({ part: 2 } & Part2CueCard)
  | ({ part: 3 } & Part3Question);

export const part1QuestionJsonSchema = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      description: "Two or three words naming the everyday topic.",
    },
    question: {
      type: "string",
      description: "One IELTS Part 1 question addressed to the candidate.",
    },
  },
  required: ["topic", "question"],
};

export const part2CueCardJsonSchema = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      description: "Two or three words naming the topic.",
    },
    prompt: {
      type: "string",
      description: "The cue card task, starting with the word Describe.",
    },
    bullets: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string" },
      description:
        "Exactly four short prompts for the candidate to cover, the last one asking them to explain or say why.",
    },
  },
  required: ["topic", "prompt", "bullets"],
};

export const part3QuestionJsonSchema = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      description: "Two or three words naming the topic.",
    },
    question: {
      type: "string",
      description:
        "One abstract Part 3 follow-up question that develops what the candidate just said.",
    },
  },
  required: ["topic", "question"],
};

// --- Evaluation ------------------------------------------------------------

/**
 * Fixed, specific categories so phase 4 can count repeated mistakes without
 * guessing. Deliberately narrower than "grammar / vocab / fluency": knowing a
 * learner makes article errors is actionable, knowing they make "grammar"
 * errors is not.
 */
export const MISTAKE_CATEGORIES = [
  "article",
  "preposition",
  "countability",
  "agreement",
  "tense",
  "word_choice",
  "collocation",
  "repetition",
  "fluency",
  "other",
] as const;

export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

/** Grammar error types reported alongside the grammar band. */
export const GRAMMAR_ERROR_TYPES = [
  "articles",
  "prepositions",
  "countability",
  "agreement",
  "tense",
] as const;

export const PRONUNCIATION_CONFIDENCE = [
  "high",
  "medium",
  "low",
  "unavailable",
] as const;

export type PronunciationConfidence =
  (typeof PRONUNCIATION_CONFIDENCE)[number];

export const mistakeSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  original: z.string().min(1),
  correction: z.string().min(1),
  explanation: z.string().min(1),
});

/**
 * A scored criterion. The refine is the evidence rule from the prompt, made
 * enforceable: a band with no quote behind it is rejected, which costs a retry
 * rather than letting an unjustified number through.
 */
const criterion = z
  .object({
    band: band.nullable(),
    evidence: z.array(quote).max(3),
  })
  .refine((value) => value.band === null || value.evidence.length >= 1, {
    message: "A scored criterion must quote at least one piece of evidence",
    path: ["evidence"],
  });

const grammarCriterion = z
  .object({
    band: band.nullable(),
    evidence: z.array(quote).max(3),
    sentences_total: z.number().int().min(0),
    sentences_with_errors: z.number().int().min(0),
    error_types: z.array(z.enum(GRAMMAR_ERROR_TYPES)).max(5),
  })
  .refine((value) => value.band === null || value.evidence.length >= 1, {
    message: "A scored criterion must quote at least one piece of evidence",
    path: ["evidence"],
  })
  .refine((value) => value.sentences_with_errors <= value.sentences_total, {
    message: "sentences_with_errors cannot exceed sentences_total",
    path: ["sentences_with_errors"],
  });

const pronunciationCriterion = z
  .object({
    band: band.nullable(),
    confidence: z.enum(PRONUNCIATION_CONFIDENCE),
    evidence: z.array(quote).max(3),
    issues: z.array(z.string().min(1)).max(5),
  })
  .refine(
    (value) =>
      value.band === null ||
      value.confidence === "unavailable" ||
      value.evidence.length >= 1 ||
      value.issues.length >= 1,
    {
      message:
        "A scored pronunciation band needs either a quoted example or a named issue",
      path: ["evidence"],
    },
  )
  .refine(
    (value) => value.confidence !== "unavailable" || value.band === null,
    {
      message: "Pronunciation confidence 'unavailable' requires a null band",
      path: ["band"],
    },
  );

export const evaluationSchema = z
  .object({
    /** May be empty when the recording held no speech; the route handles that. */
    transcript: z.string(),
    fluency: criterion,
    lexical: criterion,
    grammar: grammarCriterion,
    pronunciation: pronunciationCriterion,
    filler_notes: z.array(z.string().min(1)).max(6),
    repetition_notes: z.array(z.string().min(1)).max(6),
    strengths: z.array(z.string().min(1)).max(4),
    /**
     * Exactly three when there is something to give advice about. Capped
     * rather than fixed at the array level so the no-speech response, which
     * legitimately has nothing to suggest, stays valid.
     */
    next_steps: z.array(z.string().min(1)).max(3),
    mistakes: z.array(mistakeSchema).max(8),
  })
  .refine(
    (value) => !value.transcript.trim() || value.next_steps.length === 3,
    {
      message: "Exactly three next steps are required for a scored answer",
      path: ["next_steps"],
    },
  );

export type Evaluation = z.infer<typeof evaluationSchema>;
export type Mistake = z.infer<typeof mistakeSchema>;
export type Criterion = z.infer<typeof criterion>;

const evidenceJsonSchema = {
  type: "array",
  maxItems: 3,
  items: { type: "string" },
  description:
    "One to three short verbatim quotes from the transcript that justify this band. Required whenever a band is given.",
};

export const evaluationJsonSchema = {
  type: "object",
  properties: {
    transcript: {
      type: "string",
      description:
        "Verbatim transcript of the candidate speech, including repetitions, false starts and fillers. Empty string if there is no speech.",
    },
    fluency: {
      type: "object",
      description: "Fluency and Coherence.",
      properties: {
        band: {
          type: "number",
          nullable: true,
          description: "Band 1-9 in half steps, or null if not assessable.",
        },
        evidence: evidenceJsonSchema,
      },
      required: ["band", "evidence"],
    },
    lexical: {
      type: "object",
      description: "Lexical Resource.",
      properties: {
        band: {
          type: "number",
          nullable: true,
          description: "Band 1-9 in half steps, or null if not assessable.",
        },
        evidence: evidenceJsonSchema,
      },
      required: ["band", "evidence"],
    },
    grammar: {
      type: "object",
      description: "Grammatical Range and Accuracy.",
      properties: {
        band: {
          type: "number",
          nullable: true,
          description: "Band 1-9 in half steps, or null if not assessable.",
        },
        evidence: evidenceJsonSchema,
        sentences_total: {
          type: "integer",
          description: "How many sentences the candidate produced.",
        },
        sentences_with_errors: {
          type: "integer",
          description:
            "How many of those sentences contain at least one grammatical error.",
        },
        error_types: {
          type: "array",
          maxItems: 5,
          items: {
            type: "string",
            enum: ["articles", "prepositions", "countability", "agreement", "tense"],
          },
          description: "Main error types present, most frequent first.",
        },
      },
      required: [
        "band",
        "evidence",
        "sentences_total",
        "sentences_with_errors",
        "error_types",
      ],
    },
    pronunciation: {
      type: "object",
      description:
        "Pronunciation indicator, judged from audio only. Never an official band.",
      properties: {
        band: {
          type: "number",
          nullable: true,
          description:
            "Band 1-9 in half steps, or null when there is no audio or it cannot be judged.",
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low", "unavailable"],
          description:
            "How much the audio supports this judgement. 'unavailable' when there is no audio, which requires a null band.",
        },
        evidence: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
          description:
            "Words or phrases actually heard mispronounced or misstressed.",
        },
        issues: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
          description:
            "Concrete audible issues, or the reason the audio could not be judged.",
        },
      },
      required: ["band", "confidence", "evidence", "issues"],
    },
    filler_notes: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description:
        "Fillers and hesitation markers actually used, with roughly how often.",
    },
    repetition_notes: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description:
        "Words, phrases or structures the candidate leaned on repeatedly, quoted.",
    },
    strengths: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
      description: "Up to four specific, verifiable things this answer did well.",
    },
    next_steps: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
      description:
        "Exactly three concrete actions, highest impact first. Empty only when there is no speech.",
    },
    mistakes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "article",
              "preposition",
              "countability",
              "agreement",
              "tense",
              "word_choice",
              "collocation",
              "repetition",
              "fluency",
              "other",
            ],
          },
          original: {
            type: "string",
            description:
              "The exact words the candidate said, quoted from the transcript.",
          },
          correction: { type: "string", description: "The corrected wording." },
          explanation: {
            type: "string",
            description: "One short sentence in simple English saying why.",
          },
        },
        required: ["category", "original", "correction", "explanation"],
      },
    },
  },
  required: [
    "transcript",
    "fluency",
    "lexical",
    "grammar",
    "pronunciation",
    "filler_notes",
    "repetition_notes",
    "strengths",
    "next_steps",
    "mistakes",
  ],
};

// --- Model answer ----------------------------------------------------------

export const modelAnswerSchema = z.object({
  answer: z.string().min(1),
  changes: z.array(z.string().min(1)).min(2).max(4),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

export const modelAnswerJsonSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "The candidate's own answer re-said at around band 7.5, in natural spoken English.",
    },
    changes: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "string" },
      description:
        "Two to four specific things that were changed, each one short sentence in simple English.",
    },
  },
  required: ["answer", "changes"],
};

// --- Route inputs ----------------------------------------------------------

export const partSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const questionRequestSchema = z.object({
  part: partSchema,
  previousQuestion: z.string().max(2000).optional(),
  previousTranscript: z.string().max(20000).optional(),
});

export const modelAnswerRequestSchema = z.object({
  answerId: z.string().uuid(),
});
