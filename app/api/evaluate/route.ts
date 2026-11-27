/**
 * The core pipeline: audio in, one Gemini call, transcript and feedback saved.
 *
 * The audio bytes live only in this function's scope. They are never written
 * to disk, never put in a database column, and never logged - not even their
 * length in an error path.
 *
 * Idempotent per recording. The browser sends a `clientToken` (one UUID per
 * recording, not per attempt), and:
 *
 *   - if that token already has a marked answer, the saved result is returned
 *     without calling Gemini and without spending quota;
 *   - if two identical requests race, the unique index on
 *     (user_id, client_token) makes the loser fall back to the winner's row.
 *
 * So a double tap, or a retry after a timeout where the first call actually
 * succeeded, cannot create duplicate rows or double-count the daily cap.
 */
import { auth } from "@/auth";
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS, normaliseAudioMime } from "@/lib/audio";
import {
  createSession,
  getAnswerByClientToken,
  isUniqueViolation,
  saveEvaluation,
  sessionBelongsToUser,
} from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { DatabaseError, dbCall, databaseFailure } from "@/lib/db-guard";
import { GeminiCallError, GeminiOutputError, evaluateAnswer } from "@/lib/gemini";
import { RequestLog, errorResponse } from "@/lib/log";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { buildResultView } from "@/lib/result-view";
import { partSchema } from "@/lib/schemas";
import { score, tooShortToScore } from "@/lib/scoring";

/**
 * Vercel function timeout, in seconds.
 *
 * 60 is the ceiling on Vercel's Hobby plan (Pro allows up to 300). The Gemini
 * timeout is 55s, so a slow model produces our own clear error rather than
 * Vercel's opaque 504. If this app ever moves to Pro, both numbers can rise
 * together - but not this one alone.
 */
export const maxDuration = 60;

/** Client-reported duration we are willing to believe, with slack for the tail chunk. */
const MAX_REPORTED_DURATION_SEC = Math.ceil(MAX_RECORDING_MS / 1000) + 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const log = new RequestLog("/api/evaluate", "POST");
  try {
    return await handle(request, log);
  } catch (error) {
    /**
     * Only reached by a failure BEFORE a session id exists: ensureUser, the
     * idempotency lookup, the ownership check, the session insert, or the
     * quota claim. Everything after that point is caught inside `handle`,
     * where the session id can travel back with the error.
     *
     * Before lib/db-guard.ts existed, these five calls sat above the try and
     * a database fault from any of them escaped as a bare 500.
     */
    const dbFailed = databaseFailure(log, error);
    if (dbFailed) return dbFailed;
    return errorResponse(log, 500, "Something went wrong. Try again.", {
      errorKind: "unexpected",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function handle(request: Request, log: RequestLog): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return errorResponse(log, 401, "Not signed in.", { errorKind: "unauthenticated" });
  }
  const userId =
    session.user.id ?? (await dbCall("ensureUser", () => ensureUser(email)));
  log.setUser(userId);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(log, 400, "Expected the recording as form data.", {
      errorKind: "validation",
      detail: "formData parse failed",
    });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return errorResponse(log, 400, "No recording was attached.", {
      errorKind: "validation",
      detail: "missing audio",
    });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return errorResponse(
      log,
      413,
      "That recording is too large to upload. Keep answers under three minutes.",
      { errorKind: "validation", detail: "audio over size limit" },
    );
  }

  const mimeType = normaliseAudioMime(audio.type);
  if (!mimeType) {
    return errorResponse(
      log,
      415,
      "Your browser recorded in a format this app cannot send for marking. Try Chrome, Edge or Safari.",
      { errorKind: "validation", detail: "unsupported audio mime" },
    );
  }

  const question = (form.get("question") ?? "").toString().trim();
  if (!question || question.length > 4000) {
    return errorResponse(log, 400, "The question that was asked is missing.", {
      errorKind: "validation",
      detail: "question missing or too long",
    });
  }

  const parsedPart = partSchema.safeParse(Number(form.get("part")));
  if (!parsedPart.success) {
    return errorResponse(log, 400, "Part must be 1, 2 or 3.", {
      errorKind: "validation",
      detail: "bad part",
    });
  }
  const part = parsedPart.data;

  /**
   * Duration is client-reported, so it is clamped rather than trusted. It only
   * feeds the Part 2 length guardrail and the display; the real defence
   * against an oversized upload is the byte limit above, which the server can
   * actually verify.
   */
  const reportedDuration = Math.round(Number(form.get("durationSec") ?? 0));
  if (
    !Number.isFinite(reportedDuration) ||
    reportedDuration < 0 ||
    reportedDuration > MAX_REPORTED_DURATION_SEC
  ) {
    return errorResponse(
      log,
      400,
      "That recording length does not look right. Record the answer again.",
      { errorKind: "validation", detail: "duration out of range" },
    );
  }
  const durationSec = reportedDuration;

  const topicRaw = (form.get("topic") ?? "").toString().trim();
  const topic = topicRaw ? topicRaw.slice(0, 200) : null;

  const tokenRaw = (form.get("clientToken") ?? "").toString().trim();
  if (tokenRaw && !UUID.test(tokenRaw)) {
    return errorResponse(log, 400, "Bad request.", {
      errorKind: "validation",
      detail: "clientToken not a uuid",
    });
  }
  const clientToken = tokenRaw || null;

  // Idempotency: an already-marked recording is returned as-is. Checked before
  // the quota is touched, so a retry is free.
  if (clientToken) {
    const existing = await dbCall("getAnswerByClientToken", () =>
      getAnswerByClientToken(userId, clientToken),
    );
    if (existing) {
      log.note("evaluate_idempotent_hit", { answerId: existing.answerId });
      return log.finish(
        Response.json({
          sessionId: existing.sessionId,
          answerId: existing.answerId,
          view: existing.view,
          transcript: existing.transcript,
          durationSec: existing.durationSec,
          wordCount: existing.wordCount,
          idempotent: true,
        }),
      );
    }
  }

  // An existing session is reused; the first answer of an attempt creates one.
  let sessionId = (form.get("sessionId") ?? "").toString().trim();
  if (sessionId) {
    if (!UUID.test(sessionId)) {
      return errorResponse(log, 400, "Bad request.", {
        errorKind: "validation",
        detail: "sessionId not a uuid",
      });
    }
    const owned = await dbCall("sessionBelongsToUser", () =>
      sessionBelongsToUser(sessionId, userId),
    );
    if (!owned) {
      return errorResponse(
        log,
        403,
        "That practice session does not belong to you.",
        { errorKind: "forbidden" },
      );
    }
  } else {
    sessionId = await dbCall("createSession", () =>
      createSession({ userId, part, topic }),
    );
  }

  const allowance = await dbCall("consumeDailyAllowance", () =>
    consumeDailyAllowance(userId, "evaluate"),
  );
  if (!allowance.allowed) {
    return errorResponse(log, 429, allowance.message, {
      errorKind: `quota_${allowance.limit}`,
      extra: { sessionId },
    });
  }

  try {
    const { evaluation, provenance } = await evaluateAnswer({
      part,
      question,
      durationSec,
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType,
    });

    if (!evaluation.transcript.trim()) {
      return errorResponse(
        log,
        422,
        "No speech was picked up in that recording. Check your microphone and try again.",
        { errorKind: "no_speech", extra: { sessionId } },
      );
    }

    // Guardrail: too little speech to score fairly. Refused rather than
    // scored, because a band from six words is noise dressed as a number.
    const tooShort = tooShortToScore(evaluation.transcript);
    if (tooShort) {
      return errorResponse(log, 422, tooShort.message, {
        errorKind: "too_short",
        extra: { sessionId, transcript: evaluation.transcript },
      });
    }

    // Bands and overall are computed here, never taken from the model.
    const scored = score({ evaluation, part, durationSec });
    if (!scored) {
      return errorResponse(
        log,
        502,
        "The examiner could not score that answer. Try recording it again.",
        { errorKind: "unscorable", extra: { sessionId } },
      );
    }

    let answerId: string;
    try {
      answerId = await saveEvaluation({
        userId,
        sessionId,
        question,
        durationSec,
        evaluation,
        scored,
        provenance,
        clientToken,
      });
    } catch (cause) {
      // Two identical requests raced and the other one won. Return its result
      // rather than an error - the work was done, just not by us.
      if (clientToken && isUniqueViolation(cause)) {
        const winner = await dbCall("getAnswerByClientToken", () =>
          getAnswerByClientToken(userId, clientToken),
        );
        if (winner) {
          log.warn("evaluate_idempotent_race", { answerId: winner.answerId });
          return log.finish(
            Response.json({
              sessionId: winner.sessionId,
              answerId: winner.answerId,
              view: winner.view,
              transcript: winner.transcript,
              durationSec: winner.durationSec,
              wordCount: winner.wordCount,
              idempotent: true,
            }),
          );
        }
      }
      // Not the idempotency race, so it is a real database failure. Labelled
      // here rather than wrapping the call in dbCall, because isUniqueViolation
      // above needs the driver's own error, not a wrapped one.
      if (cause instanceof DatabaseError) throw cause;
      throw new DatabaseError("saveEvaluation", cause);
    }

    return log.finish(
      Response.json({
        sessionId,
        answerId,
        view: buildResultView({ evaluation, scored, provenance }),
        transcript: evaluation.transcript,
        durationSec,
        wordCount: evaluation.transcript.trim().split(/\s+/).length,
        usage: { used: allowance.used, cap: allowance.cap },
      }),
    );
  } catch (error) {
    // A database fault is not a marking fault. Saying so matters here more
    // than anywhere: the learner has just recorded an answer, and the client
    // keeps the audio for a retry only when the message says the recording is
    // still worth retrying.
    const dbFailed = databaseFailure(log, error, { sessionId });
    if (dbFailed) return dbFailed;

    if (error instanceof GeminiOutputError) {
      return errorResponse(
        log,
        502,
        "The examiner could not produce a usable mark for that answer. Try recording it again.",
        { errorKind: "gemini_output", extra: { sessionId } },
      );
    }

    if (error instanceof GeminiCallError) {
      return errorResponse(log, geminiStatus(error), geminiMessage(error), {
        errorKind: `gemini_${error.kind}`,
        detail: error.message,
        extra: { sessionId },
      });
    }

    return errorResponse(
      log,
      502,
      "Marking failed. Your answer was not saved - try again.",
      {
        errorKind: "unexpected",
        detail: error instanceof Error ? error.message : "unknown error",
        extra: { sessionId },
      },
    );
  }
}

/** HTTP status that matches the real cause, so retries can be automatic or not. */
function geminiStatus(error: GeminiCallError): number {
  switch (error.kind) {
    case "quota":
      return 429;
    case "timeout":
      return 504;
    case "overloaded":
      return 503;
    case "safety":
      return 422;
    default:
      return 502;
  }
}

/** Wording the learner can act on. Never includes the provider's own text. */
function geminiMessage(error: GeminiCallError): string {
  switch (error.kind) {
    case "quota":
      return "The AI service has hit its own rate limit. Wait a minute and try again - your answer was not marked, and this does not count against your daily allowance twice.";
    case "timeout":
      return "Marking took too long and was stopped. Your recording is still here - press Try again.";
    case "overloaded":
      return "The AI service is busy right now. Press Try again in a moment; your recording is kept.";
    case "safety":
      return "The AI service refused to mark that recording. Try answering the question again in different words.";
    case "auth":
      return "The app's AI credentials are not working. This one needs fixing in the server settings, not by retrying.";
    default:
      return "Marking failed. Your recording is still here - press Try again.";
  }
}
