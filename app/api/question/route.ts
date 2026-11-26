import { auth } from "@/auth";
import { generateQuestion, GeminiOutputError } from "@/lib/gemini";
import { recentTopics } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { questionRequestSchema } from "@/lib/schemas";

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

  const parsed = questionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Tell me which part you want: 1, 2 or 3." },
      { status: 400 },
    );
  }

  const { part, previousQuestion, previousTranscript } = parsed.data;

  const allowance = await consumeDailyAllowance(userId, "question");
  if (!allowance.allowed) {
    return Response.json({ error: allowance.message }, { status: 429 });
  }

  try {
    const question = await generateQuestion({
      part,
      avoidTopics: await recentTopics(userId),
      previousQuestion,
      previousTranscript,
    });
    return Response.json({
      ...question,
      usage: { used: allowance.used, cap: allowance.cap },
    });
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return Response.json(
        { error: "The question generator returned something unusable. Try again." },
        { status: 502 },
      );
    }
    console.error("POST /api/question failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return Response.json(
      { error: "Could not reach the question generator. Try again in a moment." },
      { status: 502 },
    );
  }
}
