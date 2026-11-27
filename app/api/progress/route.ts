/**
 * Everything the progress page and the weekly report need, in one request.
 *
 * All aggregation happens in SQL (see lib/db/progress.ts); this route only
 * fans out the queries and shapes the response. Every underlying query filters
 * by user_id.
 *
 * Optional `?part=1|2|3` narrows the score aggregates to one part. The streak
 * and the activity view deliberately ignore it: practising Part 2 today is
 * still practising today.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import {
  activity,
  baseline,
  currentStreak,
  dailyAverages,
  fixTheseFirst,
  mistakesByCategory,
  promptWindows,
  scoreSeries,
  weekComparison,
  weeklyAverages,
} from "@/lib/db/progress";
import { partSchema } from "@/lib/schemas";
import { APP_TIME_ZONE } from "@/lib/time";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const raw = new URL(request.url).searchParams.get("part");
  let part: 1 | 2 | 3 | undefined;
  if (raw !== null && raw !== "" && raw !== "all") {
    const parsed = partSchema.safeParse(Number(raw));
    if (!parsed.success) {
      return Response.json(
        { error: "part must be 1, 2, 3 or omitted." },
        { status: 400 },
      );
    }
    part = parsed.data;
  }

  try {
    const [
      series,
      daily,
      weekly,
      activityDays,
      streak,
      categories,
      fixFirst,
      base,
      prompts,
      weeks,
    ] = await Promise.all([
      scoreSeries(userId, part),
      dailyAverages(userId, part),
      weeklyAverages(userId, part),
      activity(userId),
      currentStreak(userId),
      mistakesByCategory(userId, part ? { part } : {}),
      fixTheseFirst(userId),
      baseline(userId, part),
      promptWindows(userId, part),
      weekComparison(userId, part),
    ]);

    return Response.json({
      timeZone: APP_TIME_ZONE,
      part: part ?? null,
      series,
      daily,
      weekly,
      activity: activityDays,
      streak,
      mistakes: { categories, fixTheseFirst: fixFirst },
      baseline: base,
      promptVersions: prompts,
      weeks,
    });
  } catch (error) {
    console.error("GET /api/progress failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return Response.json(
      { error: "Could not load your progress. Try again in a moment." },
      { status: 500 },
    );
  }
}
