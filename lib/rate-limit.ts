/**
 * Quota protection: a daily cap and a short burst limit, both counted in the
 * database so they survive restarts and hold across serverless instances.
 *
 * The daily cap is the one that protects real money, so it is exact under
 * concurrency. Phase 2 counted rows with a SELECT and then inserted, which two
 * parallel requests could both pass; this version increments a counter row
 * with one statement:
 *
 *   insert ... on conflict (pk) do update set used = used + 1 where used < cap
 *
 * On conflict Postgres takes a row lock, then re-evaluates the WHERE against
 * the locked, current row. A request over the cap therefore gets no row back,
 * and no two requests can both see "one slot left". The single-statement form
 * matters because the neon-http driver has no interactive transactions.
 *
 * Windows: the daily cap resets at midnight UTC, mirroring the provider's own
 * quota reset rather than the learner's calendar - deliberately NOT
 * APP_TIME_ZONE, which is for progress and streaks.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { apiRequests, rateBuckets } from "./db/schema";

const DEFAULT_DAILY_CAP = 40;
const DEFAULT_BURST_CAP = 6;

export type QuotaRoute = "question" | "evaluate" | "model_answer";

export function dailyCap(): number {
  return positiveInt(process.env.DAILY_REQUEST_CAP, DEFAULT_DAILY_CAP);
}

/**
 * Requests allowed in any one clock minute. Six is comfortably above normal
 * use - a Part 1 session is eight requests spread over several minutes - and
 * low enough that a runaway loop or a stuck retry cannot burn the day's
 * allowance in seconds.
 */
export function burstCap(): number {
  return positiveInt(process.env.BURST_REQUEST_CAP, DEFAULT_BURST_CAP);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type CapResult =
  | { allowed: true; used: number; cap: number }
  | {
      allowed: false;
      used: number;
      cap: number;
      message: string;
      /** Which limit refused it, for the response status and the log. */
      limit: "daily" | "burst";
    };

/** Start of the current UTC day, as a timestamptz. */
const DAY_START = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
/** Start of the current clock minute. */
const MINUTE_START = sql`date_trunc('minute', now())`;

/**
 * Increments one counter if it is below its cap. Returns the new value, or
 * null when the cap is already reached.
 */
async function consume(
  userId: string,
  kind: "day" | "minute",
  bucketStart: ReturnType<typeof sql>,
  cap: number,
): Promise<number | null> {
  const db = getDb();
  const result = await db.execute(sql`
    insert into rate_buckets (user_id, kind, bucket_start, used)
    values (${userId}, ${kind}, ${bucketStart}, 1)
    on conflict (user_id, kind, bucket_start) do update
      set used = rate_buckets.used + 1
      where rate_buckets.used < ${cap}
    returning used
  `);

  const row = result.rows[0] as { used?: unknown } | undefined;
  if (!row) return null;
  const used = Number(row.used);
  return Number.isFinite(used) ? used : null;
}

/** Gives a consumed unit back, used when a later check refuses the request. */
async function refund(
  userId: string,
  kind: "day" | "minute",
  bucketStart: ReturnType<typeof sql>,
): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    update rate_buckets
       set used = greatest(used - 1, 0)
     where user_id = ${userId}
       and kind = ${kind}
       and bucket_start = ${bucketStart}
  `);
}

async function currentUsage(
  userId: string,
  kind: "day" | "minute",
  bucketStart: ReturnType<typeof sql>,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ used: rateBuckets.used })
    .from(rateBuckets)
    .where(
      and(
        eq(rateBuckets.userId, userId),
        eq(rateBuckets.kind, kind),
        eq(rateBuckets.bucketStart, sql`${bucketStart}`),
      ),
    )
    .limit(1);
  return row?.used ?? 0;
}

/**
 * Claims one unit of quota for a Gemini-backed request.
 *
 * The daily cap is taken first because it is the expensive one, then the burst
 * limit. If the burst limit refuses, the daily unit is given back, so a user
 * who taps too fast does not lose quota for the rest of the day.
 *
 * Counted BEFORE the Gemini call on purpose: a failed call still spends the
 * provider's quota, so it should still spend ours.
 */
export async function consumeDailyAllowance(
  userId: string,
  route: QuotaRoute,
): Promise<CapResult> {
  const daily = dailyCap();
  const burst = burstCap();

  const dayUsed = await consume(userId, "day", DAY_START, daily);
  if (dayUsed === null) {
    return {
      allowed: false,
      used: await currentUsage(userId, "day", DAY_START),
      cap: daily,
      limit: "daily",
      message: `You have used today's ${daily} practice requests. The allowance resets at midnight UTC.`,
    };
  }

  const minuteUsed = await consume(userId, "minute", MINUTE_START, burst);
  if (minuteUsed === null) {
    // Hand the daily unit back: the request never happened.
    await refund(userId, "day", DAY_START);
    return {
      allowed: false,
      used: dayUsed - 1,
      cap: daily,
      limit: "burst",
      message: `That is more than ${burst} requests in a minute. Wait a moment and try again - this guard exists so a stuck retry cannot burn the day's allowance.`,
    };
  }

  // Audit trail of which route spent what. Not used for enforcement.
  await getDb().insert(apiRequests).values({ userId, route });

  return { allowed: true, used: dayUsed, cap: daily };
}

/** Today's usage without consuming anything, for display. */
export async function usageToday(
  userId: string,
): Promise<{ used: number; cap: number }> {
  return {
    used: await currentUsage(userId, "day", DAY_START),
    cap: dailyCap(),
  };
}
