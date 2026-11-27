/**
 * Starts a guest session.
 *
 * This is the only guest route that runs the bot check, and the only one that
 * mints a token. Order matters: the bot check happens BEFORE anything else, so
 * an automated client never reaches the token mint, let alone the counters.
 *
 * Writes nothing to the database. It does not even touch the counters - a
 * guest who gets a token and then leaves costs nothing, so there is nothing
 * worth counting here.
 */
import { checkBotId } from "botid/server";
import { cookies } from "next/headers";
import { guestLimits, guestModeEnabled } from "@/lib/guest/config";
import { guestCookieOptions, issueGuestToken } from "@/lib/guest/token";
import { RequestLog, errorResponse } from "@/lib/log";

export const maxDuration = 15;

export async function POST() {
  const log = new RequestLog("/api/guest/start", "POST");

  if (!guestModeEnabled()) {
    // 404, not 403: a disabled feature should not announce that it exists.
    return errorResponse(log, 404, "Not found.", { errorKind: "guest_disabled" });
  }

  // Invisible challenge, verified server-side. Nothing about the visitor is
  // stored as a result of this - the verdict is used and discarded.
  let isBot = false;
  try {
    const verdict = await checkBotId();
    isBot = "isBot" in verdict ? verdict.isBot : false;
  } catch (error) {
    // Fail CLOSED. If the bot check cannot run, guest mode does not open -
    // the alternative is an unguarded AI endpoint on the open internet.
    return errorResponse(
      log,
      503,
      "Guest mode is temporarily unavailable. Please try again shortly.",
      {
        errorKind: "botid_unavailable",
        detail: error instanceof Error ? error.message : "unknown",
      },
    );
  }

  if (isBot) {
    return errorResponse(
      log,
      403,
      "This request looks automated. Guest mode is for people trying the app; if you are a person, reload the page and try again.",
      { errorKind: "bot_rejected" },
    );
  }

  const { value, expiresAt } = issueGuestToken();
  const jar = await cookies();
  jar.set({ ...guestCookieOptions(expiresAt), value });

  const limits = guestLimits();
  return log.finish(
    Response.json({
      ok: true,
      expiresAt: expiresAt.toISOString(),
      limits: {
        evaluations: limits.evaluationsPerToken,
        questions: limits.questionsPerToken,
        maxSecondsPart13: limits.maxRecordingSecPart13,
        maxSecondsPart2: limits.maxRecordingSecPart2,
      },
    }),
  );
}
