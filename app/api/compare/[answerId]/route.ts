/**
 * Two attempts at one question, side by side.
 *
 * No Gemini call: both attempts were already marked when they were recorded,
 * so this is pure reading. The answer id may be either attempt - the query
 * resolves the original first, so the result is the same from either side.
 */
import { auth } from "@/auth";
import { getRetryComparison } from "@/lib/db/queries";
import { ensureUser } from "@/lib/db/users";
import { dbCall, databaseFailure } from "@/lib/db-guard";
import { RequestLog, errorResponse } from "@/lib/log";

/** Reject a non-uuid before it reaches Postgres, which would raise a 500. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ answerId: string }> },
) {
  const log = new RequestLog("/api/compare/[answerId]", "GET");

  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return errorResponse(log, 401, "Not signed in.", {
        errorKind: "unauthenticated",
      });
    }
    const userId =
      session.user.id ?? (await dbCall("ensureUser", () => ensureUser(email)));
    log.setUser(userId);

    const { answerId } = await params;
    if (!UUID.test(answerId)) {
      return errorResponse(log, 404, "That answer was not found.", {
        errorKind: "validation",
        detail: "id not a uuid",
      });
    }

    // Filtered by user_id throughout, so another user's id is simply absent.
    const comparison = await dbCall("getRetryComparison", () =>
      getRetryComparison(userId, answerId),
    );
    if (!comparison) {
      return errorResponse(
        log,
        404,
        "There is nothing to compare yet - this question has only been answered once.",
        { errorKind: "not_found" },
      );
    }

    return log.finish(Response.json(comparison));
  } catch (error) {
    const dbFailed = databaseFailure(log, error);
    if (dbFailed) return dbFailed;
    return errorResponse(log, 500, "Could not load the comparison.", {
      errorKind: "unexpected",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
}
