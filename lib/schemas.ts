/**
 * Shared contracts between Gemini, the API routes and the UI.
 *
 * Two representations of each payload, on purpose:
 *
 * - `*JsonSchema` is sent to Gemini to constrain generation. Gemini supports
 *   only a subset of JSON Schema and silently ignores `minLength`,
 *   `maxLength`, `uniqueItems` and friends, so these stay deliberately plain.
 * - the zod schemas are the real gate. They run on the response and enforce
 *   what Gemini will not, such as bands being half steps inside 0-9.
 */
import * as z from "zod";

export const PARTS = [1, 2, 3] as const;
export type Part = (typeof PARTS)[number];

/** IELTS bands move in half steps. Anything else is a malformed response. */
const band = z
  .number()
  .min(0)
  .max(9)
  .refine((value) => Number.isInteger(value * 2), {
    message: "Band must be a whole or half number between 0 and 9",
  });

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

export const MISTAKE_CATEGORIES = ["grammar", "vocab", "fluency"] as const;

export const mistakeSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  original: z.string().min(1),
  correction: z.string().min(1),
  explanation: z.string().min(1),
});

export const evaluationSchema = z.object({
  /** May be empty when the recording held no speech; the route handles that. */
  transcript: z.string(),
  fluency: band,
  lexical: band,
  grammar: band,
  pronunciation_est: band,
  overall: band,
  strengths: z.array(z.string().min(1)).max(4),
  next_steps: z.array(z.string().min(1)).max(4),
  mistakes: z.array(mistakeSchema).max(8),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
export type Mistake = z.infer<typeof mistakeSchema>;

export const evaluationJsonSchema = {
  type: "object",
  properties: {
    transcript: {
      type: "string",
      description:
        "Verbatim transcript of the candidate speech, including repetitions and false starts. Empty string if there is no speech.",
    },
    fluency: {
      type: "number",
      description: "Fluency and Coherence band, 0-9 in half steps.",
    },
    lexical: {
      type: "number",
      description: "Lexical Resource band, 0-9 in half steps.",
    },
    grammar: {
      type: "number",
      description: "Grammatical Range and Accuracy band, 0-9 in half steps.",
    },
    pronunciation_est: {
      type: "number",
      description:
        "Pronunciation indicator, 0-9 in half steps. An indicator only, not a band.",
    },
    overall: {
      type: "number",
      description:
        "Overall estimate, 0-9 in half steps. Never higher than the average of the four criteria.",
    },
    strengths: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
      description: "Up to four specific things the candidate did well.",
    },
    next_steps: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
      description:
        "Up to four concrete actions that would raise the score, in simple English.",
    },
    mistakes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["grammar", "vocab", "fluency"] },
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
    "pronunciation_est",
    "overall",
    "strengths",
    "next_steps",
    "mistakes",
  ],
};

// --- Route inputs ----------------------------------------------------------

export const partSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const questionRequestSchema = z.object({
  part: partSchema,
  previousQuestion: z.string().max(2000).optional(),
  previousTranscript: z.string().max(20000).optional(),
});
