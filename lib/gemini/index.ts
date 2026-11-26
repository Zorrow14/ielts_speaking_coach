/**
 * The only module that talks to Gemini. Server-only by construction: it reads
 * GEMINI_API_KEY, and the guard below fails loudly if it is ever pulled into a
 * client bundle.
 *
 * Both calls use structured JSON output and are validated with zod before the
 * result is trusted. On a validation failure the call is retried exactly once,
 * then gives up with a clear error.
 */
import { GoogleGenAI } from "@google/genai";
import type * as z from "zod";
import {
  evaluationJsonSchema,
  evaluationSchema,
  part1QuestionJsonSchema,
  part1QuestionSchema,
  part2CueCardJsonSchema,
  part2CueCardSchema,
  part3QuestionJsonSchema,
  part3QuestionSchema,
  type Evaluation,
  type Part,
  type QuestionResponse,
} from "../schemas";
import {
  EVALUATION_SYSTEM_INSTRUCTION,
  QUESTION_SYSTEM_INSTRUCTION,
  evaluationPrompt,
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

function modelName(): string {
  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error(
      "GEMINI_MODEL is not set. See .env.example for a suggested value.",
    );
  }
  return model;
}

type AudioPart = { data: Uint8Array; mimeType: string };

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
}): Promise<z.infer<T>> {
  // Built in one expression so the element type stays the SDK's content union
  // (a pushed audio part would otherwise be widened to the text part's shape).
  const input = [
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
  ];

  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const interaction = await client().interactions.create({
      model: modelName(),
      system_instruction: options.systemInstruction,
      input,
      store: false,
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
}): Promise<Evaluation> {
  return generateJson({
    systemInstruction: EVALUATION_SYSTEM_INSTRUCTION,
    prompt: evaluationPrompt({
      part: input.part,
      question: input.question,
      durationSec: input.durationSec,
    }),
    jsonSchema: evaluationJsonSchema,
    validator: evaluationSchema,
    audio: { data: input.audio, mimeType: input.mimeType },
  });
}
