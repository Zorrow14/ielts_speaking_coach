/**
 * A practice question for a guest.
 *
 * Reuses the owner's question prompts and schemas unchanged, so a guest sees
 * the same quality of material. The one difference is where "topics to avoid"
 * comes from: the owner's route reads recent topics out of the database, and a
 * guest has no history to read - so the client sends its own in-memory list.
 *
 * Writes nothing but the anonymous counter.
 */
import { GeminiCallError, GeminiOutputError, generateQuestion } from "@/lib/gemini";
import { openGuestRoute } from "@/lib/guest/guard";
import { claimGuestQuestion } from "@/lib/guest/usage";
import { RequestLog, errorResponse } from "@/lib/log";
import { guestQuestionRequestSchema } from "@/lib/schemas";

export const maxDuration = 30;

export async function POST(request: Request) {
  const log = new RequestLog("/api/guest/question", "POST");

  const gate = await openGuestRoute();
  if (!gate.ok) {
    return errorResponse(log, gate.status, gate.message, { errorKind: gate.kind });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(log, 400, "Expected a JSON body.", {
      errorKind: "validation",
      detail: "json parse failed",
    });
  }

  const parsed = guestQuestionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(log, 400, "Tell me which part you want: 1, 2 or 3.", {
      errorKind: "validation",
      // Field name only. Never the value - that is the guest's content.
      detail: parsed.error.issues[0]?.path.join(".") ?? "unknown field",
    });
  }

  const claim = await claimGuestQuestion(gate.token.gid);
  if (!claim.allowed) {
    return errorResponse(log, 429, claim.message, {
      errorKind: `guest_limit_${claim.kind}`,
    });
  }

  try {
    const question = await generateQuestion({
      part: parsed.data.part,
      avoidTopics: parsed.data.avoidTopics,
      previousQuestion: parsed.data.previousQuestion,
      previousTranscript: parsed.data.previousTranscript,
    });
    return log.finish(
      Response.json({ ...question, remaining: claim.remaining }),
    );
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return errorResponse(log, 502, "Could not write a question. Try again.", {
        errorKind: "gemini_output",
      });
    }
    if (error instanceof GeminiCallError) {
      const status =
        error.kind === "quota" ? 429 : error.kind === "timeout" ? 504 : 502;
      return errorResponse(
        log,
        status,
        error.kind === "quota"
          ? "The AI service is rate limited right now. Wait a minute and try again."
          : "Could not reach the question generator. Try again in a moment.",
        { errorKind: `gemini_${error.kind}`, detail: error.message },
      );
    }
    return errorResponse(
      log,
      502,
      "Could not reach the question generator. Try again in a moment.",
      {
        errorKind: "unexpected",
        detail: error instanceof Error ? error.message : "unknown error",
      },
    );
  }
}
