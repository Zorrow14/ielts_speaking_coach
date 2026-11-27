/**
 * Every query in here filters by user_id, including the ones that could get
 * away with filtering by a child key alone.
 *
 * Note on atomicity: the neon-http driver has no interactive transactions
 * (`db.transaction()` throws). `db.batch()` does run its statements inside one
 * Neon HTTP transaction, so saveEvaluation generates its own UUIDs up front -
 * that makes the inserts independent of each other and lets them go in a
 * single atomic batch.
 */
import { randomUUID } from "node:crypto";
import type { BatchItem } from "drizzle-orm/batch";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import { answers, feedback, mistakes, sessions } from "./schema";
import { evaluationSchema, type Evaluation, type Part } from "../schemas";
import { buildResultView, type ResultView } from "../result-view";
import type { Scored } from "../scoring";
import type { EvaluationProvenance } from "../gemini";

/** Topics from the user's recent sessions, used to steer the next question away. */
export async function recentTopics(
  userId: string,
  limit = 12,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ topic: sessions.topic })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNotNull(sessions.topic)))
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  const seen = new Set<string>();
  for (const row of rows) {
    const topic = row.topic?.trim();
    if (topic) seen.add(topic);
  }
  return [...seen];
}

/** Creates the session row for a new attempt. */
export async function createSession(input: {
  userId: string;
  part: Part;
  topic: string | null;
}): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(sessions)
    .values({ userId: input.userId, part: input.part, topic: input.topic })
    .returning({ id: sessions.id });
  if (!row) throw new Error("Could not create the practice session.");
  return row.id;
}

/** Confirms a session belongs to this user before anything is written to it. */
export async function sessionBelongsToUser(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Writes the answer, its feedback and its mistakes in one atomic batch.
 * Returns the new answer id.
 */
export async function saveEvaluation(input: {
  userId: string;
  sessionId: string;
  question: string;
  durationSec: number;
  evaluation: Evaluation;
  /** Bands and overall computed in lib/scoring.ts, not by the model. */
  scored: Scored;
  provenance: EvaluationProvenance;
}): Promise<string> {
  const db = getDb();
  const answerId = randomUUID();
  const transcript = input.evaluation.transcript.trim();
  const wordCount = transcript ? transcript.split(/\s+/).length : 0;
  const { bands } = input.scored;

  // Typed as BatchItem because the statements target different tables.
  const writes: Array<BatchItem<"pg">> = [
    db.insert(answers).values({
      id: answerId,
      sessionId: input.sessionId,
      userId: input.userId,
      question: input.question,
      transcript,
      durationSec: input.durationSec,
      wordCount,
    }),
    db.insert(feedback).values({
      id: randomUUID(),
      answerId,
      userId: input.userId,
      fluency: bands.fluency.toFixed(1),
      lexical: bands.lexical.toFixed(1),
      grammar: bands.grammar.toFixed(1),
      pronunciationEst:
        bands.pronunciation === null ? null : bands.pronunciation.toFixed(1),
      pronunciationConfidence: input.evaluation.pronunciation.confidence,
      overall: input.scored.overall.toFixed(1),
      strengths: input.evaluation.strengths,
      nextSteps: input.evaluation.next_steps,
      evidence: {
        fluency: input.evaluation.fluency.evidence,
        lexical: input.evaluation.lexical.evidence,
        grammar: input.evaluation.grammar.evidence,
        pronunciation: input.evaluation.pronunciation.evidence,
      },
      guardrails: input.scored.guardrails,
      promptVersion: input.provenance.promptVersion,
      model: input.provenance.model,
      rawJson: input.evaluation,
    }),
  ];

  for (const mistake of input.evaluation.mistakes) {
    writes.push(
      db.insert(mistakes).values({
        id: randomUUID(),
        answerId,
        userId: input.userId,
        category: mistake.category,
        original: mistake.original,
        correction: mistake.correction,
        explanation: mistake.explanation,
      }),
    );
  }

  // db.batch requires a non-empty tuple; writes always holds at least two.
  await db.batch(writes as [BatchItem<"pg">, ...Array<BatchItem<"pg">>]);
  return answerId;
}

export type HistorySession = {
  id: string;
  part: number;
  topic: string | null;
  startedAt: Date;
  answerCount: number;
  overall: string | null;
};

/** Session list for the history page: newest first. */
export async function listSessions(
  userId: string,
  limit = 50,
): Promise<HistorySession[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: sessions.id,
      part: sessions.part,
      topic: sessions.topic,
      startedAt: sessions.startedAt,
      answerCount: sql<number>`count(distinct ${answers.id})::int`,
      overall: sql<string | null>`round(avg(${feedback.overall}), 1)::text`,
    })
    .from(sessions)
    .leftJoin(
      answers,
      and(eq(answers.sessionId, sessions.id), eq(answers.userId, userId)),
    )
    .leftJoin(
      feedback,
      and(eq(feedback.answerId, answers.id), eq(feedback.userId, userId)),
    )
    .where(eq(sessions.userId, userId))
    .groupBy(sessions.id, sessions.part, sessions.topic, sessions.startedAt)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  return rows;
}

export type SavedAnswer = {
  id: string;
  question: string;
  transcript: string;
  durationSec: number | null;
  wordCount: number | null;
  createdAt: Date;
  /**
   * The same view the live result screen renders, rebuilt from storage: final
   * bands from the feedback columns, supporting detail from the stored model
   * output. Null when the answer has no saved marking.
   */
  view: ResultView | null;
};

/** One session with every saved answer and its rebuilt result view. */
export async function getSession(
  sessionId: string,
  userId: string,
): Promise<{
  session: { id: string; part: number; topic: string | null; startedAt: Date };
  answers: SavedAnswer[];
} | null> {
  const db = getDb();

  const [sessionRow] = await db
    .select({
      id: sessions.id,
      part: sessions.part,
      topic: sessions.topic,
      startedAt: sessions.startedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (!sessionRow) return null;

  const answerRows = await db
    .select({
      id: answers.id,
      question: answers.question,
      transcript: answers.transcript,
      durationSec: answers.durationSec,
      wordCount: answers.wordCount,
      createdAt: answers.createdAt,
      fluency: feedback.fluency,
      lexical: feedback.lexical,
      grammar: feedback.grammar,
      pronunciationEst: feedback.pronunciationEst,
      overall: feedback.overall,
      guardrails: feedback.guardrails,
      promptVersion: feedback.promptVersion,
      model: feedback.model,
      rawJson: feedback.rawJson,
    })
    .from(answers)
    .leftJoin(
      feedback,
      and(eq(feedback.answerId, answers.id), eq(feedback.userId, userId)),
    )
    .where(and(eq(answers.sessionId, sessionId), eq(answers.userId, userId)))
    .orderBy(answers.createdAt);

  return {
    session: sessionRow,
    answers: answerRows.map((row) => ({
      id: row.id,
      question: row.question,
      transcript: row.transcript,
      durationSec: row.durationSec,
      wordCount: row.wordCount,
      createdAt: row.createdAt,
      view: rebuildView(row),
    })),
  };
}

/**
 * Rebuilds a result view from one joined feedback row.
 *
 * The stored model output is re-validated rather than trusted: it was valid
 * when written, but the schema can move underneath it, and a feedback row from
 * an older prompt version should degrade to "no saved marking" rather than
 * crash the history page.
 */
function rebuildView(row: {
  fluency: string | null;
  lexical: string | null;
  grammar: string | null;
  pronunciationEst: string | null;
  overall: string | null;
  guardrails: Array<{ code: string; message: string }> | null;
  promptVersion: string | null;
  model: string | null;
  rawJson: unknown;
}): ResultView | null {
  if (row.overall === null || row.fluency === null) return null;

  const parsed = evaluationSchema.safeParse(row.rawJson);
  if (!parsed.success) return null;

  return buildResultView({
    evaluation: parsed.data,
    scored: {
      bands: {
        fluency: Number(row.fluency),
        lexical: Number(row.lexical ?? row.fluency),
        grammar: Number(row.grammar ?? row.fluency),
        pronunciation:
          row.pronunciationEst === null ? null : Number(row.pronunciationEst),
      },
      overall: Number(row.overall),
      guardrails: (row.guardrails ?? []) as Scored["guardrails"],
    },
    provenance: {
      promptVersion: row.promptVersion ?? "unknown",
      model: row.model ?? "unknown",
    },
  });
}

/**
 * One answer with the part it belongs to, for the model-answer route.
 * Filtered by user_id on both tables, so another user's id looks like a miss.
 */
export async function getAnswerForUser(
  answerId: string,
  userId: string,
): Promise<{ question: string; transcript: string; part: Part } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      question: answers.question,
      transcript: answers.transcript,
      part: sessions.part,
    })
    .from(answers)
    .innerJoin(
      sessions,
      and(eq(sessions.id, answers.sessionId), eq(sessions.userId, userId)),
    )
    .where(and(eq(answers.id, answerId), eq(answers.userId, userId)))
    .limit(1);

  if (!row) return null;
  // The part column is constrained to 1-3 by sessions_part_valid.
  return { ...row, part: row.part as Part };
}

/**
 * One answer with its rebuilt result view, for deep links from the mistake
 * history. Filtered by user_id on both tables.
 */
export async function getAnswerDetail(
  answerId: string,
  userId: string,
): Promise<{
  answer: SavedAnswer;
  session: { id: string; part: number; topic: string | null };
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: answers.id,
      question: answers.question,
      transcript: answers.transcript,
      durationSec: answers.durationSec,
      wordCount: answers.wordCount,
      createdAt: answers.createdAt,
      sessionId: sessions.id,
      part: sessions.part,
      topic: sessions.topic,
      fluency: feedback.fluency,
      lexical: feedback.lexical,
      grammar: feedback.grammar,
      pronunciationEst: feedback.pronunciationEst,
      overall: feedback.overall,
      guardrails: feedback.guardrails,
      promptVersion: feedback.promptVersion,
      model: feedback.model,
      rawJson: feedback.rawJson,
    })
    .from(answers)
    .innerJoin(
      sessions,
      and(eq(sessions.id, answers.sessionId), eq(sessions.userId, userId)),
    )
    .leftJoin(
      feedback,
      and(eq(feedback.answerId, answers.id), eq(feedback.userId, userId)),
    )
    .where(and(eq(answers.id, answerId), eq(answers.userId, userId)))
    .limit(1);

  if (!row) return null;

  return {
    answer: {
      id: row.id,
      question: row.question,
      transcript: row.transcript,
      durationSec: row.durationSec,
      wordCount: row.wordCount,
      createdAt: row.createdAt,
      view: rebuildView(row),
    },
    session: { id: row.sessionId, part: row.part, topic: row.topic },
  };
}
