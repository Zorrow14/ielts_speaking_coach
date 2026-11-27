/**
 * Turning database failures into answers instead of bare 500s.
 *
 * Why this exists: on 27 Nov 2026 the deployed app returned a naked 500 from
 * `/api/question` for an hour. The cause was `relation "rate_buckets" does not
 * exist` - production was five migrations behind the code it was running. The
 * route could not say so, because `consumeDailyAllowance()` was called before
 * the `try` block, so the throw escaped the handler entirely: no classified
 * response, no structured log line, nothing in the body but a 500.
 *
 * Two jobs here:
 *
 *   1. `dbCall` tags every database call with the step it belongs to, so a
 *      failure says WHICH call failed rather than just "something broke".
 *   2. `databaseFailure` recognises the Postgres error codes that mean the
 *      schema is behind the code, and says exactly that - because that is a
 *      deployment mistake, not a transient fault, and retrying never fixes it.
 *
 * The user-facing message never contains the driver's text. The step name and
 * the SQLSTATE go to the log, which is where they are useful.
 */
import { RequestLog, errorResponse } from "./log";

/**
 * SQLSTATE codes that mean "the code expects something the database does not
 * have". Every one of these is schema drift, never a transient failure.
 *
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const SCHEMA_DRIFT_CODES = new Set([
  "42P01", // undefined_table      - a missing table, e.g. rate_buckets
  "42703", // undefined_column     - a missing column, e.g. feedback.prompt_version
  "42704", // undefined_object     - a missing type, e.g. an enum
  "42883", // undefined_function
  "42P10", // invalid_column_reference - an on-conflict target that does not exist
]);

/** A database call that failed, remembering which one it was. */
export class DatabaseError extends Error {
  readonly step: string;
  readonly code?: string;

  constructor(step: string, cause: unknown) {
    super(`database step "${step}" failed`);
    this.name = "DatabaseError";
    this.step = step;
    this.code = sqlStateOf(cause);
    this.cause = cause;
  }

  /** True when the failure means the database is behind the deployed code. */
  get schemaBehind(): boolean {
    return this.code !== undefined && SCHEMA_DRIFT_CODES.has(this.code);
  }
}

/**
 * Pulls the SQLSTATE out of whatever the driver threw.
 *
 * Drizzle wraps the driver error in its own "Failed query" Error and puts the
 * NeonDbError on `cause`, so the code is one or more levels down. The loop is
 * depth-limited because a cause chain can, in principle, be circular.
 */
function sqlStateOf(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Runs one database call, labelled.
 *
 * Wrap every database call a route makes, including the ones before the main
 * try block - `ensureUser`, the quota claim, an ownership check. The label is
 * what turns "500" into "the quota claim failed because rate_buckets is
 * missing".
 */
export async function dbCall<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause; // already labelled
    throw new DatabaseError(step, cause);
  }
}

/**
 * Builds the response for a database failure, or returns null if this error is
 * not one.
 *
 * Returning null rather than throwing lets a route keep its own classification
 * for Gemini errors:
 *
 *   catch (error) {
 *     const dbFailed = databaseFailure(log, error);
 *     if (dbFailed) return dbFailed;
 *     ...existing Gemini handling...
 *   }
 *
 * Status choice: 503, not 500. Both schema drift and an unreachable database
 * are "the server is not currently able to handle this", and 503 tells a
 * monitor the difference between a broken deployment and a broken request.
 */
export function databaseFailure(
  log: RequestLog,
  error: unknown,
  extra?: Record<string, unknown>,
): Response | null {
  if (!(error instanceof DatabaseError)) return null;

  if (error.schemaBehind) {
    return errorResponse(
      log,
      503,
      "The app is temporarily out of step with its database and cannot save or read this right now. This needs a fix on the server; retrying will not help.",
      {
        errorKind: "schema_behind",
        // The step and SQLSTATE are the whole diagnosis, and neither is secret.
        detail: `${error.step} failed with ${error.code}`,
        extra,
      },
    );
  }

  return errorResponse(
    log,
    503,
    "The database could not be reached. Try again in a moment.",
    {
      errorKind: "database_unavailable",
      detail: `${error.step} failed${error.code ? ` with ${error.code}` : ""}`,
      extra,
    },
  );
}
