/**
 * The only module that talks to Gemini. Server-only by construction: it reads
 * GEMINI_API_KEY, and the guard below fails loudly if it is ever pulled into a
 * client bundle.
 *
 * Both calls use structured JSON output and are validated with zod before the
 * result is trusted. On a validation failure the call is retried exactly once,
 * then gives up with a clear error.
 *
 * Evaluation runs at a low temperature with a fixed seed: the same answer
 * should get the same band twice, and creativity is not wanted in a mark.
 */
import { GoogleGenAI } from "@google/genai";
import type * as z from "zod";
import {
  evaluationJsonSchema,
  evaluationSchema,
  modelAnswerJsonSchema,
  modelAnswerSchema,
  part1QuestionJsonSchema,
  part1QuestionSchema,
  part2CueCardJsonSchema,
  part2CueCardSchema,
  part3QuestionJsonSchema,
  part3QuestionSchema,
  type Evaluation,
  type ModelAnswer,
  type Part,
  type QuestionResponse,
} from "../schemas";
import {
  EVALUATION_SEED,
  EVALUATION_TEMPERATURE,
  MODEL_ANSWER_TEMPERATURE,
} from "../scoring";
import {
  EVALUATION_SYSTEM_INSTRUCTION,
  MODEL_ANSWER_SYSTEM_INSTRUCTION,
  PROMPT_VERSION,
  evaluationPrompt,
  modelAnswerPrompt,
} from "../prompts/evaluate";
import {
  QUESTION_SYSTEM_INSTRUCTION,
  part1Prompt,
  part2Prompt,
  part3Prompt,
} from "./prompts";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gemini is server-only: it holds the API key and must never be imported into a client component.",
  );
}

/** Thrown when Gemini is reachable but its answer cannot be trusted. */
export class GeminiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiOutputError";
  }
}

/**
 * Why a Gemini call failed, mapped to something the caller can act on.
 *
 * `quota` is deliberately separate from `overloaded`: retrying an overloaded
 * model may work, retrying a quota error cannot, and burning a second request
 * to confirm that is exactly what the daily cap exists to prevent.
 */
export type GeminiFailureKind =
  | "quota"
  | "overloaded"
  | "timeout"
  | "safety"
  | "bad_request"
  | "auth"
  | "unknown";

export class GeminiCallError extends Error {
  readonly kind: GeminiFailureKind;
  readonly status?: number;

  constructor(kind: GeminiFailureKind, message: string, status?: number) {
    super(message);
    this.name = "GeminiCallError";
    this.kind = kind;
    this.status = status;
  }

  /** True when a second attempt could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === "overloaded";
  }
}

/** How long to wait for one Gemini call before giving up. */
export const GEMINI_TIMEOUT_MS = 55_000;

/** Turns an SDK rejection into a classified error. Never includes the key. */
export function classifyGeminiError(cause: unknown): GeminiCallError {
  const status =
    typeof cause === "object" && cause !== null && "status" in cause
      ? Number((cause as { status: unknown }).status)
      : undefined;
  const raw = cause instanceof Error ? cause.message : String(cause);
  // Lower-cased for matching only; the raw text is never sent to the client.
  const text = raw.toLowerCase();

  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new GeminiCallError("timeout", "Gemini did not respond in time.");
  }
  if (
    text.includes("aborted") ||
    text.includes("timed out") ||
    text.includes("timeout")
  ) {
    return new GeminiCallError("timeout", "Gemini did not respond in time.");
  }
  if (status === 429 || text.includes("rate limit") || text.includes("quota")) {
    return new GeminiCallError(
      "quota",
      "Gemini refused the request: rate limit or quota reached.",
      status,
    );
  }
  if (status === 503 || status === 500 || text.includes("high demand")) {
    return new GeminiCallError(
      "overloaded",
      "Gemini is overloaded right now.",
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new GeminiCallError(
      "auth",
      "Gemini rejected the API key.",
      status,
    );
  }
  if (text.includes("safety") || text.includes("blocked")) {
    return new GeminiCallError(
      "safety",
      "Gemini blocked the content of that request.",
      status,
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new GeminiCallError(
      "bad_request",
      "Gemini rejected the shape of the request.",
      status,
    );
  }
  return new GeminiCallError("unknown", "Gemini call failed.", status);
}

let cached: GoogleGenAI | undefined;

function client(): GoogleGenAI {
  if (!cached) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to .env.local (and to the Vercel project).",
      );
    }
    cached = new GoogleGenAI({ apiKey });
  }
  return cached;
}

export function modelName(): string {
  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error(
      "GEMINI_MODEL is not set. See .env.example for a suggested value.",
    );
  }
  return model;
}

type AudioPart = { data: Uint8Array; mimeType: string };

type GenerationConfig = { temperature?: number; seed?: number };

/**
 * One Gemini call that must come back as schema-valid JSON, with a single
 * retry. `store: false` keeps Google from retaining the request for later
 * retrieval, which matters because the request carries the audio.
 */
async function generateJson<T extends z.ZodTypeAny>(options: {
  systemInstruction: string;
  prompt: string;
  jsonSchema: object;
  validator: T;
  audio?: AudioPart;
  generationConfig?: GenerationConfig;
}): Promise<z.infer<T>> {
  // The v1 interactions API takes a list of STEPS, not bare content parts:
  // passing `{ type: "text" }` at the top level is rejected with
  // "The value 'text' is not supported for 'input[0].type' in v1".
  // The prompt and any audio therefore go inside one `user_input` step.
  //
  // Built in one expression so the element type stays the SDK's content union
  // (a pushed audio part would otherwise be widened to the text part's shape).
  const input = [
    {
      type: "user_input" as const,
      content: [
        { type: "text" as const, text: options.prompt },
        ...(options.audio
          ? [
              {
                type: "audio" as const,
                data: Buffer.from(options.audio.data).toString("base64"),
                mime_type: options.audio.mimeType,
              },
            ]
          : []),
      ],
    },
  ];

  let lastProblem = "";

  // At most two attempts in total, shared between transport failures and
  // schema failures. A quota error ends the loop immediately.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let interaction;
    try {
      interaction = await client().interactions.create(
        {
          model: modelName(),
          system_instruction: options.systemInstruction,
          input,
          store: false,
          ...(options.generationConfig
            ? { generation_config: options.generationConfig }
            : {}),
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: options.jsonSchema,
          },
        },
        {
          timeout_ms: GEMINI_TIMEOUT_MS,
          // Retries are handled here, once, and never for quota errors - the
          // SDK's own backoff would quietly spend extra quota.
          retries: { strategy: "none" },
        },
      );
    } catch (cause) {
      const error = classifyGeminiError(cause);
      if (!error.retryable || attempt === 2) throw error;
      lastProblem = error.message;
      continue;
    }

    const text = interaction.output_text;
    if (!text) {
      lastProblem = "Gemini returned an empty response.";
      continue;
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
    } catch {
      lastProblem = "Gemini returned text that is not valid JSON.";
      continue;
    }

    const parsed = options.validator.safeParse(candidate);
    if (parsed.success) return parsed.data;

    lastProblem = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }

  throw new GeminiOutputError(
    `Gemini did not return usable output after one retry. Last problem: ${lastProblem}`,
  );
}

/** Generates the next question, cue card or follow-up. */
export async function generateQuestion(input: {
  part: Part;
  avoidTopics: string[];
  previousQuestion?: string;
  previousTranscript?: string;
}): Promise<QuestionResponse> {
  if (input.part === 1) {
    const result = await generateJson({
      systemInstruction: QUESTION_SYSTEM_INSTRUCTION,
      prompt: part1Prompt(input.avoidTopics),
      jsonSchema: part1QuestionJsonSchema,
      validator: part1QuestionSchema,
    });
    return { part: 1, ...result };
  }

  if (input.part === 2) {
    const result = await generateJson({
      systemInstruction: QUESTION_SYSTEM_INSTRUCTION,
      prompt: part2Prompt(input.avoidTopics),
      jsonSchema: part2CueCardJsonSchema,
      validator: part2CueCardSchema,
    });
    return { part: 2, ...result };
  }

  const result = await generateJson({
    systemInstruction: QUESTION_SYSTEM_INSTRUCTION,
    prompt: part3Prompt({
      previousQuestion: input.previousQuestion ?? "",
      previousTranscript: input.previousTranscript ?? "",
      avoidTopics: input.avoidTopics,
    }),
    jsonSchema: part3QuestionJsonSchema,
    validator: part3QuestionSchema,
  });
  return { part: 3, ...result };
}

/** What produced an evaluation, stored alongside it. */
export type EvaluationProvenance = { promptVersion: string; model: string };

export type EvaluationResult = {
  evaluation: Evaluation;
  provenance: EvaluationProvenance;
};

/**
 * Transcribes and scores one spoken answer in a single call. The audio bytes
 * are passed through to Gemini and never written anywhere.
 */
export async function evaluateAnswer(input: {
  part: Part;
  question: string;
  durationSec: number;
  audio: Uint8Array;
  mimeType: string;
}): Promise<EvaluationResult> {
  const evaluation = await generateJson({
    systemInstruction: EVALUATION_SYSTEM_INSTRUCTION,
    prompt: evaluationPrompt({
      part: input.part,
      question: input.question,
      durationSec: input.durationSec,
      hasAudio: true,
    }),
    jsonSchema: evaluationJsonSchema,
    validator: evaluationSchema,
    audio: { data: input.audio, mimeType: input.mimeType },
    generationConfig: {
      temperature: EVALUATION_TEMPERATURE,
      seed: EVALUATION_SEED,
    },
  });
  return {
    evaluation,
    provenance: { promptVersion: PROMPT_VERSION, model: modelName() },
  };
}

/**
 * Scores a transcript with no audio. Used by the calibration harness, which
 * works from written fixtures: it exercises the same prompt and schema as the
 * live path, minus pronunciation, which is honestly reported as unavailable
 * rather than guessed from spelling.
 *
 * `seed` is overridable so repeated calibration runs are independent samples
 * rather than three copies of one answer.
 */
export async function evaluateTranscript(input: {
  part: Part;
  question: string;
  transcript: string;
  durationSec?: number;
  seed?: number;
}): Promise<EvaluationResult> {
  const evaluation = await generateJson({
    systemInstruction: EVALUATION_SYSTEM_INSTRUCTION,
    prompt: evaluationPrompt({
      part: input.part,
      question: input.question,
      durationSec: input.durationSec ?? 0,
      hasAudio: false,
      transcript: input.transcript,
    }),
    jsonSchema: evaluationJsonSchema,
    validator: evaluationSchema,
    generationConfig: {
      temperature: EVALUATION_TEMPERATURE,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
    },
  });
  return {
    evaluation,
    provenance: { promptVersion: PROMPT_VERSION, model: modelName() },
  };
}

/**
 * A band 7.5 version of the learner's own answer. Generated on demand only,
 * after the answer has been marked - never before they have spoken.
 */
export async function generateModelAnswer(input: {
  part: Part;
  question: string;
  transcript: string;
}): Promise<ModelAnswer> {
  return generateJson({
    systemInstruction: MODEL_ANSWER_SYSTEM_INSTRUCTION,
    prompt: modelAnswerPrompt(input),
    jsonSchema: modelAnswerJsonSchema,
    validator: modelAnswerSchema,
    generationConfig: { temperature: MODEL_ANSWER_TEMPERATURE },
  });
}
