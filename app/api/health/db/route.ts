/**
 * TEMPORARY HEALTH CHECK - phase 1 only.
 *
 * Proves the Neon connection end to end from the server: writes one row for
 * the signed-in user, reads it back by id, then deletes it so nothing is left
 * behind. Delete this file (and the card linking to it on the home page) once
 * phase 2 writes real rows.
 */
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { ensureUser } from "@/lib/db/users";
import { vocabNotebook } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  // Older sessions may predate the token carrying our own user id.
  const userId = session.user.id ?? (await ensureUser(email));
  const db = getDb();

  try {
    const [written] = await db
      .insert(vocabNotebook)
      .values({
        userId,
        phrase: "health check",
        meaning: "temporary row written by /api/health/db",
      })
      .returning({ id: vocabNotebook.id, createdAt: vocabNotebook.createdAt });

    // Read it back, filtered by user_id as every query must be.
    const readBack = await db
      .select({
        id: vocabNotebook.id,
        phrase: vocabNotebook.phrase,
        createdAt: vocabNotebook.createdAt,
      })
      .from(vocabNotebook)
      .where(
        and(
          eq(vocabNotebook.id, written.id),
          eq(vocabNotebook.userId, userId),
        ),
      )
      .limit(1);

    await db
      .delete(vocabNotebook)
      .where(
        and(
          eq(vocabNotebook.id, written.id),
          eq(vocabNotebook.userId, userId),
        ),
      );

    return Response.json({
      ok: readBack.length === 1,
      wrote: written.id,
      readBack: readBack[0] ?? null,
      deleted: true,
      note: "Temporary phase 1 health check. Remove before phase 2.",
    });
  } catch (error) {
    // Message only - never echo the connection string or environment values.
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 500 },
    );
  }
}
