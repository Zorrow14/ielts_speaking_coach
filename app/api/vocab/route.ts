/**
 * The vocabulary notebook collection: list and create.
 *
 * No Gemini call here, so no daily cap - saving a phrase should never be
 * rationed. Every query filters by user_id.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import { dbCall, databaseFailure } from "@/lib/db-guard";
import { addVocab, listVocab, vocabCounts } from "@/lib/db/vocab";
import { RequestLog, errorResponse } from "@/lib/log";
import { vocabCreateSchema, vocabSourceSchema } from "@/lib/schemas";

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return session.user.id ?? (await dbCall("ensureUser", () => ensureUser(email)));
}

export async function GET(request: Request) {
  const log = new RequestLog("/api/vocab", "GET");

  try {
    const userId = await currentUserId();
    if (!userId) {
      return errorResponse(log, 401, "Not signed in.", {
        errorKind: "unauthenticated",
      });
    }
    log.setUser(userId);

    const params = new URL(request.url).searchParams;
    const sourceRaw = params.get("source");
    const source = sourceRaw
      ? vocabSourceSchema.safeParse(sourceRaw)
      : ({ success: true, data: "all" } as const);
    if (!source.success) {
      return errorResponse(log, 400, "source must be all, feedback or manual.", {
        errorKind: "validation",
        detail: "bad source",
      });
    }

    // Bounded so a pathological query string cannot drive an expensive ILIKE.
    const search = (params.get("search") ?? "").slice(0, 200);

    const [entries, counts] = await dbCall("listVocab", () =>
      Promise.all([
        listVocab(userId, { search, source: source.data }),
        vocabCounts(userId),
      ]),
    );

    return log.finish(Response.json({ entries, counts }));
  } catch (error) {
    const dbFailed = databaseFailure(log, error);
    if (dbFailed) return dbFailed;
    return errorResponse(
      log,
      500,
      "Could not load your notebook. Try again in a moment.",
      {
        errorKind: "unexpected",
        detail: error instanceof Error ? error.message : "unknown error",
      },
    );
  }
}

export async function POST(request: Request) {
  const log = new RequestLog("/api/vocab", "POST");

  try {
    const userId = await currentUserId();
    if (!userId) {
      return errorResponse(log, 401, "Not signed in.", {
        errorKind: "unauthenticated",
      });
    }
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

    const parsed = vocabCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        log,
        400,
        "A phrase is required, up to 200 characters.",
        { errorKind: "validation" },
      );
    }

    /**
     * Deliberately NOT wrapped in dbCall.
     *
     * A rejected insert here is usually the caller's fault - a
     * source_answer_id pointing at somebody else's answer trips the foreign
     * key - and that is a 400, not a 503. The outer catch still turns a
     * genuine outage into a classified 503, because an unreachable database
     * throws before the insert is ever attempted.
     */
    try {
      const entry = await addVocab(userId, parsed.data);
      return log.finish(Response.json({ entry }, { status: 201 }));
    } catch (cause) {
      return errorResponse(log, 400, "Could not save that phrase.", {
        errorKind: "insert_rejected",
        detail: cause instanceof Error ? cause.message : "unknown error",
      });
    }
  } catch (error) {
    const dbFailed = databaseFailure(log, error);
    if (dbFailed) return dbFailed;
    return errorResponse(log, 500, "Could not save that phrase.", {
      errorKind: "unexpected",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
}
