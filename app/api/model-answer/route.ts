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
import { generateModelAnswer, GeminiOutputError } from "@/lib/gemini";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { modelAnswerRequestSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = session.user.id ?? (await ensureUser(email));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = modelAnswerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Which answer? An answer id is required." },
      { status: 400 },
    );
  }

  // Filtered by user_id, so somebody else's answer id is simply not found.
  const answer = await getAnswerForUser(parsed.data.answerId, userId);
  if (!answer) {
    return Response.json({ error: "That answer was not found." }, { status: 404 });
  }
  if (!answer.transcript.trim()) {
    return Response.json(
      { error: "That answer has no transcript to improve." },
      { status: 422 },
    );
  }

  const allowance = await consumeDailyAllowance(userId, "model_answer");
  if (!allowance.allowed) {
    return Response.json({ error: allowance.message }, { status: 429 });
  }

  try {
    const modelAnswer = await generateModelAnswer({
      part: answer.part,
      question: answer.question,
      transcript: answer.transcript,
    });
    return Response.json({
      ...modelAnswer,
      usage: { used: allowance.used, cap: allowance.cap },
    });
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return Response.json(
        { error: "Could not write a usable example answer. Try again." },
        { status: 502 },
      );
    }
    console.error("POST /api/model-answer failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return Response.json(
      { error: "Could not reach the example generator. Try again in a moment." },
      { status: 502 },
    );
  }
}
