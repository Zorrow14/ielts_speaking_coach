/**
 * Daily cap on the Gemini-backed routes, counted from the database so it
 * survives restarts and works across serverless instances.
 *
 * The window is the current UTC day. That is predictable and cheap to count;
 * the trade-off is that the allowance resets at midnight UTC, not local
 * midnight.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { apiRequests } from "./db/schema";

const DEFAULT_CAP = 40;

export function dailyCap(): number {
  const raw = process.env.DAILY_REQUEST_CAP;
  if (!raw) return DEFAULT_CAP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP;
}

export type CapResult =
  | { allowed: true; used: number; cap: number }
  | { allowed: false; used: number; cap: number; message: string };

/**
 * Counts today's requests for this user, and if there is room, records this
 * one. The row is written BEFORE the Gemini call on purpose: a failed call
 * still spends quota, so it should still count.
 */
export async function consumeDailyAllowance(
  userId: string,
  route: "question" | "evaluate",
): Promise<CapResult> {
  const db = getDb();
  const cap = dailyCap();

  const [counted] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(apiRequests)
    .where(
      and(
        eq(apiRequests.userId, userId),
        gte(apiRequests.createdAt, sql`date_trunc('day', now() at time zone 'utc')`),
      ),
    );

  const used = counted?.used ?? 0;
  if (used >= cap) {
    return {
      allowed: false,
      used,
      cap,
      message: `You have used today's ${cap} practice requests. The allowance resets at midnight UTC.`,
    };
  }

  await db.insert(apiRequests).values({ userId, route });
  return { allowed: true, used: used + 1, cap };
}
