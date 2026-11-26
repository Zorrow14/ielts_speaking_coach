/**
 * The core pipeline: audio in, one Gemini call, transcript and feedback saved.
 *
 * The audio bytes live only in this function's scope. They are never written
 * to disk, never put in a database column, and never logged - not even their
 * length in an error path.
 */
import { auth } from "@/auth";
import { MAX_AUDIO_BYTES, normaliseAudioMime } from "@/lib/audio";
import {
  createSession,
  saveEvaluation,
  sessionBelongsToUser,
} from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { evaluateAnswer, GeminiOutputError } from "@/lib/gemini";
import { consumeDailyAllowance } from "@/lib/rate-limit";
import { partSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = session.user.id ?? (await ensureUser(email));

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected the recording as form data." },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json(
      { error: "No recording was attached." },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      {
        error:
          "That recording is too large to upload. Keep answers under three minutes.",
      },
      { status: 413 },
    );
  }

  const mimeType = normaliseAudioMime(audio.type);
  if (!mimeType) {
    return Response.json(
      {
        error:
          "Your browser recorded in a format this app cannot send for marking. Try Chrome, Edge or Safari.",
      },
      { status: 415 },
    );
  }

  const question = (form.get("question") ?? "").toString().trim();
  if (!question) {
    return Response.json(
      { error: "The question that was asked is missing." },
      { status: 400 },
    );
  }

  const parsedPart = partSchema.safeParse(Number(form.get("part")));
  if (!parsedPart.success) {
    return Response.json({ error: "Part must be 1, 2 or 3." }, { status: 400 });
  }
  const part = parsedPart.data;

  const durationSec = Math.max(
    0,
    Math.round(Number(form.get("durationSec") ?? 0)) || 0,
  );
  const topic = (form.get("topic") ?? "").toString().trim() || null;

  // An existing session is reused; the first answer of an attempt creates one.
  let sessionId = (form.get("sessionId") ?? "").toString().trim();
  if (sessionId) {
    if (!(await sessionBelongsToUser(sessionId, userId))) {
      return Response.json(
        { error: "That practice session does not belong to you." },
        { status: 403 },
      );
    }
  } else {
    sessionId = await createSession({ userId, part, topic });
  }

  const allowance = await consumeDailyAllowance(userId, "evaluate");
  if (!allowance.allowed) {
    return Response.json({ error: allowance.message }, { status: 429 });
  }

  try {
    const evaluation = await evaluateAnswer({
      part,
      question,
      durationSec,
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType,
    });

    if (!evaluation.transcript.trim()) {
      return Response.json(
        {
          error:
            "No speech was picked up in that recording. Check your microphone and try again.",
          sessionId,
        },
        { status: 422 },
      );
    }

    const answerId = await saveEvaluation({
      userId,
      sessionId,
      question,
      durationSec,
      evaluation,
    });

    return Response.json({
      sessionId,
      answerId,
      evaluation,
      usage: { used: allowance.used, cap: allowance.cap },
    });
  } catch (error) {
    if (error instanceof GeminiOutputError) {
      return Response.json(
        {
          error:
            "The examiner could not produce a usable mark for that answer. Try recording it again.",
          sessionId,
        },
        { status: 502 },
      );
    }
    console.error("POST /api/evaluate failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return Response.json(
      {
        error: "Marking failed. Your answer was not saved - try again.",
        sessionId,
      },
      { status: 502 },
    );
  }
}
