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
import { RequestLog, errorResponse } from "@/lib/log";
import { vocabUpdateSchema } from "@/lib/schemas";
/** Reject a non-uuid before it reaches Postgres, which would raise a 500. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


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
  const log = new RequestLog("/api/vocab/[id]", "PATCH");
  const userId = await currentUserId();
  if (!userId) {
    return errorResponse(log, 401, "Not signed in.", {
      errorKind: "unauthenticated",
    });
  }
  log.setUser(userId);
  const { id } = await params;
  if (!UUID.test(id)) {
    return errorResponse(log, 404, "That entry was not found.", {
      errorKind: "validation",
      detail: "id not a uuid",
    });
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

  const parsed = vocabUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(log, 400, "Nothing valid to update.", {
      errorKind: "validation",
    });
  }

  // Filtered by user_id in the UPDATE, so another user id looks missing.
  const entry = await updateVocab(userId, id, parsed.data);
  if (!entry) {
    return errorResponse(log, 404, "That entry was not found.", {
      errorKind: "not_found",
    });
  }
  return log.finish(Response.json({ entry }));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = new RequestLog("/api/vocab/[id]", "DELETE");
  const userId = await currentUserId();
  if (!userId) {
    return errorResponse(log, 401, "Not signed in.", {
      errorKind: "unauthenticated",
    });
  }
  log.setUser(userId);
  const { id } = await params;
  if (!UUID.test(id)) {
    return errorResponse(log, 404, "That entry was not found.", {
      errorKind: "validation",
      detail: "id not a uuid",
    });
  }

  const removed = await deleteVocab(userId, id);
  if (!removed) {
    return errorResponse(log, 404, "That entry was not found.", {
      errorKind: "not_found",
    });
  }
  return log.finish(Response.json({ ok: true }));
}
