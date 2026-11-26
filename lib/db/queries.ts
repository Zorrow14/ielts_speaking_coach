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
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import { answers, feedback, mistakes, sessions } from "./schema";
import type { Evaluation, Part } from "../schemas";

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
}): Promise<string> {
  const db = getDb();
  const answerId = randomUUID();
  const transcript = input.evaluation.transcript.trim();
  const wordCount = transcript ? transcript.split(/\s+/).length : 0;

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
      fluency: input.evaluation.fluency.toFixed(1),
      lexical: input.evaluation.lexical.toFixed(1),
      grammar: input.evaluation.grammar.toFixed(1),
      pronunciationEst: input.evaluation.pronunciation_est.toFixed(1),
      overall: input.evaluation.overall.toFixed(1),
      strengths: input.evaluation.strengths,
      nextSteps: input.evaluation.next_steps,
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
  scores: {
    fluency: string;
    lexical: string;
    grammar: string;
    pronunciationEst: string;
    overall: string;
    strengths: string[];
    nextSteps: string[];
  } | null;
  mistakes: Array<{
    category: "grammar" | "vocab" | "fluency";
    original: string;
    correction: string;
    explanation: string | null;
  }>;
};

/** One session with every saved answer, feedback and mistake. */
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
      strengths: feedback.strengths,
      nextSteps: feedback.nextSteps,
    })
    .from(answers)
    .leftJoin(
      feedback,
      and(eq(feedback.answerId, answers.id), eq(feedback.userId, userId)),
    )
    .where(and(eq(answers.sessionId, sessionId), eq(answers.userId, userId)))
    .orderBy(answers.createdAt);

  const answerIds = answerRows.map((row) => row.id);
  const mistakeRows = answerIds.length
    ? await db
        .select({
          answerId: mistakes.answerId,
          category: mistakes.category,
          original: mistakes.original,
          correction: mistakes.correction,
          explanation: mistakes.explanation,
        })
        .from(mistakes)
        .where(
          and(
            inArray(mistakes.answerId, answerIds),
            eq(mistakes.userId, userId),
          ),
        )
    : [];

  return {
    session: sessionRow,
    answers: answerRows.map((row) => ({
      id: row.id,
      question: row.question,
      transcript: row.transcript,
      durationSec: row.durationSec,
      wordCount: row.wordCount,
      createdAt: row.createdAt,
      scores:
        row.overall === null
          ? null
          : {
              fluency: row.fluency ?? "0.0",
              lexical: row.lexical ?? "0.0",
              grammar: row.grammar ?? "0.0",
              pronunciationEst: row.pronunciationEst ?? "0.0",
              overall: row.overall,
              strengths: row.strengths ?? [],
              nextSteps: row.nextSteps ?? [],
            },
      mistakes: mistakeRows
        .filter((mistake) => mistake.answerId === row.id)
        .map(({ category, original, correction, explanation }) => ({
          category,
          original,
          correction,
          explanation,
        })),
    })),
  };
}
