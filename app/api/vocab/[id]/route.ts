/**
 * A single notebook entry: edit or delete.
 *
 * Both operations carry user_id in the WHERE clause, so another user's id
 * returns 404 rather than touching the row. That is the authorisation check -
 * there is no separate "do I own this" query to forget.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import { deleteVocab, updateVocab } from "@/lib/db/vocab";
import { vocabUpdateSchema } from "@/lib/schemas";

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return session.user.id ?? (await ensureUser(email));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = vocabUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Nothing valid to update." },
      { status: 400 },
    );
  }

  const entry = await updateVocab(userId, id, parsed.data);
  if (!entry) {
    return Response.json({ error: "That entry was not found." }, { status: 404 });
  }
  return Response.json({ entry });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;

  const removed = await deleteVocab(userId, id);
  if (!removed) {
    return Response.json({ error: "That entry was not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
