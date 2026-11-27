/**
 * Marks one guest answer.
 *
 * This route is the whole privacy promise in one file, so what it does NOT do
 * matters as much as what it does:
 *
 *   - it does not import lib/db/queries, lib/db/vocab or lib/db/progress, so
 *     there is no reachable code path that writes a session, answer, feedback
 *     row, mistake or notebook entry. A test walks the import graph to prove
 *     it stays that way;
 *   - it never writes the audio anywhere. The bytes exist in this function's
 *     scope, go to Gemini, and are gone;
 *   - it never logs the transcript, the question, the feedback or the audio.
 *     The log line is route, status, duration and error kind;
 *   - it returns the result and keeps nothing. The guest's browser holds the
 *     only copy, in memory, until they refresh.
 *
 * Everything about the MARKING is reused from the owner's pipeline unchanged -
 * the same prompt, the same zod schema, the same scoring-in-code and the same
 * guardrails - so guest feedback is the real thing, not a demo.
 */
import { normaliseAudioMime } from "@/lib/audio";
import { GeminiCallError, GeminiOutputError, evaluateAnswer } from "@/lib/gemini";
import {
  DURATION_TOLERANCE_SEC,
  guestLimits,
  maxRecordingSec,
} from "@/lib/guest/config";
import { openGuestRoute } from "@/lib/guest/guard";
import { claimGuestEvaluation, hashRequestIp } from "@/lib/guest/usage";
import { RequestLog, errorResponse } from "@/lib/log";
import { buildResultView } from "@/lib/result-view";
import { partSchema } from "@/lib/schemas";
import { countWords, score, tooShortToScore } from "@/lib/scoring";

export const maxDuration = 60;

export async function POST(request: Request) {
  const log = new RequestLog("/api/guest/evaluate", "POST");

  const gate = await openGuestRoute();
  if (!gate.ok) {
    return errorResponse(log, gate.status, gate.message, { errorKind: gate.kind });
  }

  const limits = guestLimits();

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
  if (audio.size > limits.maxAudioBytes) {
    return errorResponse(
      log,
      413,
      "That recording is too large for guest mode. Guest answers are capped at two minutes.",
      { errorKind: "validation", detail: "audio over guest size limit" },
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

  const parsedPart = partSchema.safeParse(Number(form.get("part")));
  if (!parsedPart.success) {
    return errorResponse(log, 400, "Part must be 1, 2 or 3.", {
      errorKind: "validation",
      detail: "bad part",
    });
  }
  const part = parsedPart.data;

  const question = (form.get("question") ?? "").toString().trim();
  if (!question || question.length > 4000) {
    return errorResponse(log, 400, "The question that was asked is missing.", {
      errorKind: "validation",
      detail: "question missing or too long",
    });
  }

  /**
   * Guest recordings are shorter than the owner's: 90 seconds for Parts 1 and
   * 3, two minutes for Part 2. Enforced here and not only in the browser,
   * because the browser is the one thing we cannot trust.
   */
  const ceiling = maxRecordingSec(part, limits);
  const reportedDuration = Math.round(Number(form.get("durationSec") ?? 0));
  if (!Number.isFinite(reportedDuration) || reportedDuration < 0) {
    return errorResponse(log, 400, "That recording length does not look right.", {
      errorKind: "validation",
      detail: "duration not a number",
    });
  }
  if (reportedDuration > ceiling + DURATION_TOLERANCE_SEC) {
    return errorResponse(
      log,
      413,
      `Guest answers are limited to ${ceiling} seconds for this part. Record a shorter answer, or sign in as the owner for the full three minutes.`,
      { errorKind: "guest_limit_duration" },
    );
  }
  const durationSec = reportedDuration;

  // The three counters. Nothing identifying is written: the IP is hashed in
  // memory and only the hash is stored.
  const claim = await claimGuestEvaluation({
    gid: gate.token.gid,
    ipHash: hashRequestIp(request),
  });
  if (!claim.allowed) {
    return errorResponse(log, 429, claim.message, {
      errorKind: `guest_limit_${claim.kind}`,
      extra: { limit: claim.kind },
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
        { errorKind: "no_speech" },
      );
    }

    const tooShort = tooShortToScore(evaluation.transcript);
    if (tooShort) {
      return errorResponse(log, 422, tooShort.message, {
        errorKind: "too_short",
      });
    }

    const scored = score({ evaluation, part, durationSec });
    if (!scored) {
      return errorResponse(
        log,
        502,
        "The examiner could not score that answer. Try recording it again.",
        { errorKind: "unscorable" },
      );
    }

    // Returned, not stored. This response is the only copy that will ever
    // exist, and it lives in the guest's tab until they refresh.
    return log.finish(
      Response.json({
        view: buildResultView({ evaluation, scored, provenance }),
        transcript: evaluation.transcript,
        durationSec,
        wordCount: countWords(evaluation.transcript),
        remaining: claim.remaining,
      }),
    );
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return errorResponse(
        log,
        502,
        "The examiner could not produce a usable mark for that answer. Try recording it again.",
        { errorKind: "gemini_output" },
      );
    }
    if (error instanceof GeminiCallError) {
      const status =
        error.kind === "quota"
          ? 429
          : error.kind === "timeout"
            ? 504
            : error.kind === "overloaded"
              ? 503
              : 502;
      return errorResponse(
        log,
        status,
        error.kind === "quota"
          ? "The AI service is rate limited right now. Wait a minute and try again."
          : error.kind === "timeout"
            ? "Marking took too long and was stopped. Your recording is still here - press Try again."
            : "Marking failed. Your recording is still here - press Try again.",
        { errorKind: `gemini_${error.kind}`, detail: error.message },
      );
    }
    return errorResponse(
      log,
      502,
      "Marking failed. Your recording is still here - press Try again.",
      {
        errorKind: "unexpected",
        detail: error instanceof Error ? error.message : "unknown error",
      },
    );
  }
}
