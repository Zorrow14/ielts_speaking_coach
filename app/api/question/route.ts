import { auth } from "@/auth";
import { generateQuestion, GeminiCallError, GeminiOutputError } from "@/lib/gemini";
import { recentTopics } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { RequestLog, errorResponse } from "@/lib/log";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { questionRequestSchema } from "@/lib/schemas";

/** A question is a small text call; it has no business taking a minute. */
export const maxDuration = 30;

export async function POST(request: Request) {
  const log = new RequestLog("/api/question", "POST");

  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return errorResponse(log, 401, "Not signed in.", {
      errorKind: "unauthenticated",
    });
  }
  const userId = session.user.id ?? (await ensureUser(email));
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

  const parsed = questionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(log, 400, "Tell me which part you want: 1, 2 or 3.", {
      errorKind: "validation",
      detail: parsed.error.issues[0]?.path.join(".") ?? "unknown field",
    });
  }

  const { part, previousQuestion, previousTranscript } = parsed.data;

  const allowance = await consumeDailyAllowance(userId, "question");
  if (!allowance.allowed) {
    return errorResponse(log, 429, allowance.message, {
      errorKind: `quota_${allowance.limit}`,
    });
  }

  try {
    const question = await generateQuestion({
      part,
      avoidTopics: await recentTopics(userId),
      previousQuestion,
      previousTranscript,
    });
    return log.finish(
      Response.json({
        ...question,
        usage: { used: allowance.used, cap: allowance.cap },
      }),
    );
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return errorResponse(
        log,
        502,
        "The question generator returned something unusable. Try again.",
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
          ? "The AI service has hit its own rate limit. Wait a minute and try again."
          : error.kind === "timeout"
            ? "The question took too long to arrive. Try again."
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
