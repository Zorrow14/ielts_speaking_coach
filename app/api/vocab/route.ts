/**
 * The vocabulary notebook collection: list and create.
 *
 * No Gemini call here, so no daily cap - saving a phrase should never be
 * rationed. Every query filters by user_id.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import { addVocab, listVocab, vocabCounts } from "@/lib/db/vocab";
import { vocabCreateSchema, vocabSourceSchema } from "@/lib/schemas";

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return session.user.id ?? (await ensureUser(email));
}

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const sourceRaw = params.get("source");
  const source = sourceRaw
    ? vocabSourceSchema.safeParse(sourceRaw)
    : ({ success: true, data: "all" } as const);
  if (!source.success) {
    return Response.json(
      { error: "source must be all, feedback or manual." },
      { status: 400 },
    );
  }

  const [entries, counts] = await Promise.all([
    listVocab(userId, {
      search: params.get("search") ?? undefined,
      source: source.data,
    }),
    vocabCounts(userId),
  ]);

  return Response.json({ entries, counts });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = vocabCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "A phrase is required, up to 200 characters." },
      { status: 400 },
    );
  }

  try {
    const entry = await addVocab(userId, parsed.data);
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    // A source_answer_id for somebody else's answer trips the foreign key
    // rather than silently attaching; treat it as a bad request.
    console.error("POST /api/vocab failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return Response.json(
      { error: "Could not save that phrase." },
      { status: 400 },
    );
  }
}
