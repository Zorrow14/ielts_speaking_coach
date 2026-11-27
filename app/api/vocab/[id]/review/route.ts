/**
 * Records one review of a notebook phrase and schedules the next.
 *
 * The schedule itself lives in lib/db/vocab.ts; this route only validates the
 * verdict and enforces ownership through the WHERE clause.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import { recordReview } from "@/lib/db/vocab";
import { vocabReviewSchema } from "@/lib/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = session.user.id ?? (await ensureUser(email));
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = vocabReviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "result must be got_it or again." },
      { status: 400 },
    );
  }

  const entry = await recordReview(userId, id, parsed.data.result);
  if (!entry) {
    return Response.json({ error: "That entry was not found." }, { status: 404 });
  }
  return Response.json({ entry });
}
