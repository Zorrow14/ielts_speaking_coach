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

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const interaction = await client().interactions.create({
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
    });

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
