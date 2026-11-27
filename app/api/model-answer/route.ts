/**
 * A band 7.5 version of an answer the learner has already given.
 *
 * Generated on demand only. The route works from a SAVED answer id, so it is
 * impossible to reach before the learner has spoken and been marked - which is
 * the tutoring rule in the plan, enforced by the shape of the endpoint rather
 * than by the UI remembering to hide a button.
 *
 * Counted against the daily cap like the other Gemini-backed routes.
 */
import { auth } from "@/auth";
import { getAnswerForUser } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { dbCall, databaseFailure } from "@/lib/db-guard";
import {
  generateModelAnswer,
  GeminiCallError,
  GeminiOutputError,
} from "@/lib/gemini";
import { RequestLog, errorResponse } from "@/lib/log";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { modelAnswerRequestSchema } from "@/lib/schemas";

export const maxDuration = 45;

export async function POST(request: Request) {
  const log = new RequestLog("/api/model-answer", "POST");

  // One try around the whole handler: a database failure anywhere in it must
  // become a classified 503, not a bare 500. See lib/db-guard.ts.
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return errorResponse(log, 401, "Not signed in.", {
        errorKind: "unauthenticated",
      });
    }
    const userId =
      session.user.id ?? (await dbCall("ensureUser", () => ensureUser(email)));
    log.setUser(userId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(log, 400, "Expected a JSON body.", {
        errorKind: "validation",
        detail: "json parse failed",
      });
    }

    const parsed = modelAnswerRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(log, 400, "Which answer? An answer id is required.", {
        errorKind: "validation",
        detail: "answerId missing or not a uuid",
      });
    }

    // Filtered by user_id, so somebody else's answer id is simply not found.
    const answer = await dbCall("getAnswerForUser", () =>
      getAnswerForUser(parsed.data.answerId, userId),
    );
    if (!answer) {
      return errorResponse(log, 404, "That answer was not found.", {
        errorKind: "not_found",
      });
    }
    if (!answer.transcript.trim()) {
      return errorResponse(log, 422, "That answer has no transcript to improve.", {
        errorKind: "no_transcript",
      });
    }

    const allowance = await dbCall("consumeDailyAllowance", () =>
      consumeDailyAllowance(userId, "model_answer"),
    );
    if (!allowance.allowed) {
      return errorResponse(log, 429, allowance.message, {
        errorKind: `quota_${allowance.limit}`,
      });
    }

    const modelAnswer = await generateModelAnswer({
      part: answer.part,
      question: answer.question,
      transcript: answer.transcript,
    });
    return log.finish(
      Response.json({
        ...modelAnswer,
        usage: { used: allowance.used, cap: allowance.cap },
      }),
    );
  } catch (error) {
    const dbFailed = databaseFailure(log, error);
    if (dbFailed) return dbFailed;

    if (error instanceof GeminiOutputError) {
      return errorResponse(
        log,
        502,
        "Could not write a usable example answer. Try again.",
        { errorKind: "gemini_output" },
      );
    }
    if (error instanceof GeminiCallError) {
      return errorResponse(
        log,
        error.kind === "quota" ? 429 : error.kind === "timeout" ? 504 : 502,
        error.kind === "quota"
          ? "The AI service has hit its own rate limit. Wait a minute and try again."
          : "Could not reach the example generator. Try again in a moment.",
        { errorKind: `gemini_${error.kind}`, detail: error.message },
      );
    }
    return errorResponse(
      log,
      502,
      "Could not reach the example generator. Try again in a moment.",
      {
        errorKind: "unexpected",
        detail: error instanceof Error ? error.message : "unknown error",
      },
    );
  }
}
