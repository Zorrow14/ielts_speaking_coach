/**
 * Structured server logging.
 *
 * One JSON line per request, which is what makes Vercel's log search useful.
 * Every line carries a request id so a user-visible error can be traced to the
 * exact invocation.
 *
 * What is deliberately NEVER logged, because the plan's hard rules say so and
 * because logs are the easiest place to leak by accident:
 *
 *   - audio bytes, or even their length
 *   - transcripts, questions, or any learner text
 *   - prompts, system instructions, or model output
 *   - environment variables, API keys, connection strings
 *
 * Only an error's `message` is logged, never its stack, and never the raw
 * provider response. User ids are logged because they are opaque UUIDs that
 * identify a row, not a person.
 */

export type LogLevel = "info" | "warn" | "error";

export type RequestOutcome = {
  requestId: string;
  route: string;
  method: string;
  userId?: string;
  status: number;
  durationMs: number;
  /** A short machine-readable reason, e.g. "quota" or "validation". */
  errorKind?: string;
  /** Short, already-sanitised detail. Never raw provider text. */
  detail?: string;
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Per-request logger. Created at the top of a route, finished once on the way
 * out, so every path produces exactly one outcome line.
 */
export class RequestLog {
  readonly requestId = newRequestId();
  private readonly startedAt = Date.now();
  private userId?: string;
  private finished = false;

  constructor(
    readonly route: string,
    readonly method: string,
  ) {}

  setUser(userId: string) {
    this.userId = userId;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Logs the outcome and returns the response, so routes can `return log.finish(...)`. */
  finish(
    response: Response,
    extra: { errorKind?: string; detail?: string } = {},
  ): Response {
    if (!this.finished) {
      this.finished = true;
      const outcome: RequestOutcome = {
        requestId: this.requestId,
        route: this.route,
        method: this.method,
        userId: this.userId,
        status: response.status,
        durationMs: this.elapsedMs,
        ...extra,
      };
      emit(
        response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
        "request",
        outcome as unknown as Record<string, unknown>,
      );
    }
    // The id goes back on the response so a reported error can be found.
    const headers = new Headers(response.headers);
    headers.set("x-request-id", this.requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /** A note mid-request. Keep `fields` free of learner text. */
  note(event: string, fields: Record<string, unknown> = {}) {
    emit("info", event, { requestId: this.requestId, route: this.route, ...fields });
  }

  warn(event: string, fields: Record<string, unknown> = {}) {
    emit("warn", event, { requestId: this.requestId, route: this.route, ...fields });
  }
}

/**
 * A JSON error response that never leaks internals.
 *
 * The message is always one we wrote. The request id is included so a user can
 * quote it, and the matching server line holds the (already sanitised) detail.
 */
export function errorResponse(
  log: RequestLog,
  status: number,
  message: string,
  options: { errorKind?: string; detail?: string; extra?: Record<string, unknown> } = {},
): Response {
  return log.finish(
    Response.json(
      { error: message, requestId: log.requestId, ...(options.extra ?? {}) },
      { status },
    ),
    { errorKind: options.errorKind, detail: options.detail },
  );
}
