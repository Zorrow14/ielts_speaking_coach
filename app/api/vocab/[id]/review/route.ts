/**
 * Records one review of a notebook phrase and schedules the next.
 *
 * The schedule itself lives in lib/db/vocab.ts; this route only validates the
 * verdict and enforces ownership through the WHERE clause.
 */
import { auth } from "@/auth";
import { ensureUser } from "@/lib/db/users";
import { recordReview } from "@/lib/db/vocab";
import { RequestLog, errorResponse } from "@/lib/log";
import { vocabReviewSchema } from "@/lib/schemas";
/** Reject a non-uuid before it reaches Postgres, which would raise a 500. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = new RequestLog("/api/vocab/[id]/review", "POST");
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return errorResponse(log, 401, "Not signed in.", {
      errorKind: "unauthenticated",
    });
  }
  const userId = session.user.id ?? (await ensureUser(email));
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

  const parsed = vocabReviewSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(log, 400, "result must be got_it or again.", {
      errorKind: "validation",
      detail: "bad result value",
    });
  }

  const entry = await recordReview(userId, id, parsed.data.result);
  if (!entry) {
    return errorResponse(log, 404, "That entry was not found.", {
      errorKind: "not_found",
    });
  }
  return log.finish(Response.json({ entry }));
}
