/**
 * Guest usage counters. THE ONLY database code a guest route may reach.
 *
 * This module imports `getDb` and nothing else from lib/db. It must never
 * import lib/db/queries, lib/db/vocab or lib/db/progress, and a test walks the
 * import graph of every guest route to prove it has not started to.
 *
 * Privacy properties, in order of importance:
 *
 * 1. Nothing identifying is stored. The subject column is an HMAC, and the
 *    salt includes the day, so the same guest produces a different hash
 *    tomorrow. Yesterday's rows cannot be joined to today's to build a
 *    history of anybody.
 * 2. No content. Not the audio, not the transcript, not the question, not the
 *    score. A row is a count.
 * 3. No raw IP and no user agent ever reaches the database. The IP is hashed
 *    in memory and the hash is what is written.
 *
 * Counting is atomic: one `insert ... on conflict do update ... where
 * count < limit` statement per check, the same pattern lib/rate-limit.ts uses,
 * so parallel guests cannot both claim the last slot.
 */
import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { guestUsage } from "../db/schema";
import { guestLimits } from "./config";

/** The counters a guest route claims against. */
export type GuestEndpoint = "question" | "evaluate";

/** Fixed subject for the all-guests budget, which is not per-person. */
const GLOBAL_SUBJECT = "global";

/** How a limit refusal is reported, so each gets its own wording. */
export type GuestLimitKind =
  | "token_evaluations"
  | "token_questions"
  | "ip_evaluations"
  | "global_budget";

export type GuestClaim =
  | { allowed: true; remaining: number }
  | { allowed: false; kind: GuestLimitKind; message: string };

/** Today in UTC, as the date the counters are keyed by. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The daily-rotating salt.
 *
 * AUTH_SECRET supplies the secret half and the UTC day supplies the rotation.
 * Deriving it rather than storing it means there is nothing to rotate by hand,
 * and because the day is mixed in, a hash is only comparable within its own
 * day - which is exactly the window the counters need and no longer.
 */
function dailySalt(day: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set; it salts the guest usage hashes.");
  }
  return createHmac("sha256", secret).update(`guest-salt:${day}`).digest("hex");
}

/**
 * Hashes a guest id or an IP into a subject key.
 *
 * Exported for the tests, which assert that the same input on two different
 * days produces unrelated hashes.
 */
export function hashSubject(value: string, day = today()): string {
  return createHmac("sha256", dailySalt(day))
    .update(value)
    .digest("base64url")
    .slice(0, 32);
}

/**
 * Claims one unit against a counter, if it is below its limit.
 * Returns the new count, or null when the limit is already reached.
 */
async function claim(
  subject: string,
  day: string,
  endpoint: string,
  limit: number,
): Promise<number | null> {
  const db = getDb();
  const result = await db.execute(sql`
    insert into guest_usage (subject, day, endpoint, count)
    values (${subject}, ${day}::date, ${endpoint}, 1)
    on conflict (subject, day, endpoint) do update
      set count = guest_usage.count + 1
      where guest_usage.count < ${limit}
    returning count
  `);

  const row = result.rows[0] as { count?: unknown } | undefined;
  if (!row) return null;
  const count = Number(row.count);
  return Number.isFinite(count) ? count : null;
}

/** Hands a claimed unit back when a later check refuses the request. */
async function release(
  subject: string,
  day: string,
  endpoint: string,
): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    update guest_usage
       set count = greatest(count - 1, 0)
     where subject = ${subject}
       and day = ${day}::date
       and endpoint = ${endpoint}
  `);
}

/**
 * Deletes counters older than today.
 *
 * Lazy rather than a cron job, and that is a considered choice: the table is a
 * handful of rows a day, the salt has already rotated so old rows are
 * meaningless, and a cron job is one more piece of infrastructure to configure
 * and then forget to check. Fired opportunistically and never awaited by the
 * caller's critical path - a failure here must not fail a guest's request.
 */
function sweepOldRows(): void {
  void getDb()
    .delete(guestUsage)
    .where(lt(guestUsage.day, sql`(now() at time zone 'utc')::date`))
    .catch(() => {
      // Deliberately silent: cleanup is housekeeping, not correctness, and
      // logging it would add noise on every guest request.
    });
}

/**
 * Claims quota for one guest question.
 *
 * Questions are cheap, so only the per-token limit applies - the global budget
 * and the IP limit guard evaluations, which are what actually cost money.
 */
export async function claimGuestQuestion(gid: string): Promise<GuestClaim> {
  const limits = guestLimits();
  const day = today();
  const subject = hashSubject(gid, day);

  const used = await claim(subject, day, "question", limits.questionsPerToken);
  if (used === null) {
    return {
      allowed: false,
      kind: "token_questions",
      message: `You have used all ${limits.questionsPerToken} practice questions for this guest session. Sign in as the owner for unlimited practice, or come back tomorrow.`,
    };
  }

  sweepOldRows();
  return { allowed: true, remaining: limits.questionsPerToken - used };
}

/**
 * Claims quota for one guest evaluation, against three counters.
 *
 * Order matters. The global budget is claimed FIRST, because it is the one
 * that protects the bill and the one most likely to be exhausted; claiming it
 * last would mean the cheaper counters had already been spent on a request
 * that could not proceed. Anything claimed before a refusal is released.
 */
export async function claimGuestEvaluation(input: {
  gid: string;
  ipHash: string;
}): Promise<GuestClaim> {
  const limits = guestLimits();
  const day = today();
  const tokenSubject = hashSubject(input.gid, day);

  const globalUsed = await claim(
    GLOBAL_SUBJECT,
    day,
    "evaluate",
    limits.globalEvaluations,
  );
  if (globalUsed === null) {
    return {
      allowed: false,
      kind: "global_budget",
      message:
        "Guest mode has used up today's shared allowance across everyone trying the app. Nothing is wrong - come back tomorrow and it resets.",
    };
  }

  const tokenUsed = await claim(
    tokenSubject,
    day,
    "evaluate",
    limits.evaluationsPerToken,
  );
  if (tokenUsed === null) {
    await release(GLOBAL_SUBJECT, day, "evaluate");
    return {
      allowed: false,
      kind: "token_evaluations",
      message: `Guest mode marks ${limits.evaluationsPerToken} answers per visit. That is enough to see what the feedback looks like - sign in as the owner for unlimited practice.`,
    };
  }

  const ipUsed = await claim(
    input.ipHash,
    day,
    "evaluate_ip",
    limits.evaluationsPerIp,
  );
  if (ipUsed === null) {
    await release(GLOBAL_SUBJECT, day, "evaluate");
    await release(tokenSubject, day, "evaluate");
    return {
      allowed: false,
      kind: "ip_evaluations",
      message: `This connection has already marked ${limits.evaluationsPerIp} guest answers today. Come back tomorrow, or sign in as the owner.`,
    };
  }

  sweepOldRows();
  return { allowed: true, remaining: limits.evaluationsPerToken - tokenUsed };
}

/**
 * Hashes the caller's IP.
 *
 * Takes the leftmost x-forwarded-for entry, which on Vercel is the client. The
 * raw value never leaves this function: only the hash is returned, and only
 * the hash is ever written or logged. An absent header hashes a constant, so
 * requests with no discoverable IP share one bucket rather than bypassing the
 * limit entirely.
 */
export function hashRequestIp(request: Request, day = today()): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const real = request.headers.get("x-real-ip") ?? "";
  const ip = (forwarded.split(",")[0] ?? "").trim() || real.trim() || "unknown";
  return hashSubject(`ip:${ip}`, day);
}
