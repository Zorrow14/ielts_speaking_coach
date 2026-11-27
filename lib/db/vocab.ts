/**
 * Vocabulary notebook reads and writes. Every statement filters by user_id,
 * including the updates and the delete - an id alone is never enough.
 *
 * Review scheduling is a fixed ladder, not a spaced-repetition algorithm:
 * 1, 3, 7 then 14 days, and "again" drops back to the first rung. That is a
 * deliberate simplification. Real SM-2 style scheduling needs an ease factor
 * per card and a lot more tuning than one learner's notebook justifies, and
 * the plan lists this feature as the first thing to cut.
 */
import { and, asc, desc, eq, ilike, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { vocabNotebook } from "./schema";

/** Days to wait after each successful review. The last rung repeats. */
export const REVIEW_LADDER = [1, 3, 7, 14] as const;

/** The next rung up from the current interval. */
export function nextInterval(current: number): number {
  const index = REVIEW_LADDER.indexOf(current as (typeof REVIEW_LADDER)[number]);
  if (index === -1) return REVIEW_LADDER[0];
  return REVIEW_LADDER[Math.min(index + 1, REVIEW_LADDER.length - 1)];
}

export type VocabEntry = {
  id: string;
  phrase: string;
  meaning: string | null;
  example: string | null;
  sourceAnswerId: string | null;
  nextReview: string | null;
  intervalDays: number;
  reviewCount: number;
  createdAt: string;
};

export type VocabSource = "all" | "feedback" | "manual";

function toEntry(row: typeof vocabNotebook.$inferSelect): VocabEntry {
  return {
    id: row.id,
    phrase: row.phrase,
    meaning: row.meaning,
    example: row.example,
    sourceAnswerId: row.sourceAnswerId,
    nextReview: row.nextReview ? row.nextReview.toISOString() : null,
    intervalDays: row.intervalDays,
    reviewCount: row.reviewCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listVocab(
  userId: string,
  options: { search?: string; source?: VocabSource; limit?: number } = {},
): Promise<VocabEntry[]> {
  const db = getDb();
  const search = options.search?.trim();
  const source = options.source ?? "all";

  const rows = await db
    .select()
    .from(vocabNotebook)
    .where(
      and(
        eq(vocabNotebook.userId, userId),
        source === "feedback"
          ? isNotNull(vocabNotebook.sourceAnswerId)
          : source === "manual"
            ? isNull(vocabNotebook.sourceAnswerId)
            : undefined,
        search
          ? or(
              ilike(vocabNotebook.phrase, `%${search}%`),
              ilike(vocabNotebook.meaning, `%${search}%`),
              ilike(vocabNotebook.example, `%${search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(vocabNotebook.createdAt))
    .limit(options.limit ?? 500);

  return rows.map(toEntry);
}

export async function addVocab(
  userId: string,
  input: {
    phrase: string;
    meaning?: string | null;
    example?: string | null;
    sourceAnswerId?: string | null;
  },
): Promise<VocabEntry> {
  const db = getDb();
  const [row] = await db
    .insert(vocabNotebook)
    .values({
      userId,
      phrase: input.phrase.trim(),
      meaning: input.meaning?.trim() || null,
      example: input.example?.trim() || null,
      sourceAnswerId: input.sourceAnswerId ?? null,
      // Due immediately, so a new phrase turns up in the first review round.
      nextReview: new Date(),
      intervalDays: 0,
      reviewCount: 0,
    })
    .returning();

  if (!row) throw new Error("Could not save that phrase.");
  return toEntry(row);
}

/** Returns null when the entry does not exist OR belongs to someone else. */
export async function updateVocab(
  userId: string,
  id: string,
  fields: { phrase?: string; meaning?: string | null; example?: string | null },
): Promise<VocabEntry | null> {
  const db = getDb();
  const patch: Partial<typeof vocabNotebook.$inferInsert> = {};
  if (fields.phrase !== undefined) patch.phrase = fields.phrase.trim();
  if (fields.meaning !== undefined) patch.meaning = fields.meaning?.trim() || null;
  if (fields.example !== undefined) patch.example = fields.example?.trim() || null;

  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select()
      .from(vocabNotebook)
      .where(and(eq(vocabNotebook.id, id), eq(vocabNotebook.userId, userId)))
      .limit(1);
    return row ? toEntry(row) : null;
  }

  const [row] = await db
    .update(vocabNotebook)
    .set(patch)
    .where(and(eq(vocabNotebook.id, id), eq(vocabNotebook.userId, userId)))
    .returning();

  return row ? toEntry(row) : null;
}

/** False when the entry does not exist or is not this user's. */
export async function deleteVocab(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(vocabNotebook)
    .where(and(eq(vocabNotebook.id, id), eq(vocabNotebook.userId, userId)))
    .returning({ id: vocabNotebook.id });
  return rows.length > 0;
}

/** Phrases due now, oldest due date first. */
export async function dueForReview(
  userId: string,
  limit = 20,
): Promise<VocabEntry[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(vocabNotebook)
    .where(
      and(
        eq(vocabNotebook.userId, userId),
        or(
          isNull(vocabNotebook.nextReview),
          lte(vocabNotebook.nextReview, sql`now()`),
        ),
      ),
    )
    .orderBy(asc(vocabNotebook.nextReview), asc(vocabNotebook.createdAt))
    .limit(limit);

  return rows.map(toEntry);
}

/**
 * Records one review and schedules the next.
 *
 * "got it" climbs the ladder; "again" resets to the first rung, because a
 * phrase you could not use is not one to postpone for a fortnight.
 */
export async function recordReview(
  userId: string,
  id: string,
  result: "got_it" | "again",
): Promise<VocabEntry | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(vocabNotebook)
    .where(and(eq(vocabNotebook.id, id), eq(vocabNotebook.userId, userId)))
    .limit(1);
  if (!existing) return null;

  const intervalDays =
    result === "got_it" ? nextInterval(existing.intervalDays) : REVIEW_LADDER[0];

  const [row] = await db
    .update(vocabNotebook)
    .set({
      intervalDays,
      reviewCount: existing.reviewCount + 1,
      nextReview: sql`now() + make_interval(days => ${intervalDays})`,
    })
    .where(and(eq(vocabNotebook.id, id), eq(vocabNotebook.userId, userId)))
    .returning();

  return row ? toEntry(row) : null;
}

export type VocabCounts = { total: number; fromFeedback: number; due: number };

export async function vocabCounts(userId: string): Promise<VocabCounts> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      fromFeedback: sql<number>`count(${vocabNotebook.sourceAnswerId})::int`,
      due: sql<number>`count(*) filter (where ${vocabNotebook.nextReview} is null or ${vocabNotebook.nextReview} <= now())::int`,
    })
    .from(vocabNotebook)
    .where(eq(vocabNotebook.userId, userId));

  return row ?? { total: 0, fromFeedback: 0, due: 0 };
}
