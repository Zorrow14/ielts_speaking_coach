/**
 * The database failure path.
 *
 * These exist because of a real incident: production ran five migrations
 * behind the deployed code, and `/api/question` answered with a bare 500 and
 * no log line, because the failing call sat above the route's try block. The
 * tests below simulate exactly that driver error and assert the three things
 * that were missing - a classified status, a body the user can act on, and a
 * structured log line that names the failing step.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DatabaseError, dbCall, databaseFailure } from "../../lib/db-guard";
import { RequestLog } from "../../lib/log";

/**
 * A driver error shaped exactly like the one Neon threw on 27 Nov 2026:
 * drizzle's own "Failed query" Error with the NeonDbError on `cause`.
 */
function neonError(code: string, message: string): Error {
  const inner = new Error(message);
  Object.assign(inner, { severity: "ERROR", code });
  const outer = new Error(
    "Failed query: insert into rate_buckets (user_id, kind, bucket_start, used) values ($1, $2, $3, 1)",
  );
  outer.cause = inner;
  return outer;
}

/** Captures the JSON log lines emitted while `fn` runs. */
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const sinks = ["log", "warn", "error"] as const;
  const originals = sinks.map((name) => console[name]);
  for (const name of sinks) {
    console[name] = (...args: unknown[]) => void lines.push(String(args[0]));
  }
  try {
    await fn();
  } finally {
    sinks.forEach((name, index) => {
      console[name] = originals[index];
    });
  }
  return lines;
}

afterEach(() => {
  // Nothing global to reset; captureLogs restores its own patches.
});

describe("DatabaseError", () => {
  it("finds the SQLSTATE through drizzle's wrapper", () => {
    const error = new DatabaseError(
      "consumeDailyAllowance",
      neonError("42P01", 'relation "rate_buckets" does not exist'),
    );
    assert.equal(error.code, "42P01");
    assert.equal(error.step, "consumeDailyAllowance");
  });

  it("recognises the codes that mean the schema is behind", () => {
    for (const code of ["42P01", "42703", "42704", "42883", "42P10"]) {
      const error = new DatabaseError("step", neonError(code, "nope"));
      assert.equal(error.schemaBehind, true, `${code} should be schema drift`);
    }
  });

  it("does not call a connection failure schema drift", () => {
    // 08006 is connection_failure: transient, and retrying is reasonable.
    const error = new DatabaseError("step", neonError("08006", "connection lost"));
    assert.equal(error.schemaBehind, false);
  });

  it("copes with an error carrying no code at all", () => {
    const error = new DatabaseError("step", new Error("socket hang up"));
    assert.equal(error.code, undefined);
    assert.equal(error.schemaBehind, false);
  });

  it("does not loop forever on a circular cause chain", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    const error = new DatabaseError("step", a);
    assert.equal(error.code, undefined);
  });
});

describe("dbCall", () => {
  it("passes the value through when nothing fails", async () => {
    assert.equal(await dbCall("step", async () => 42), 42);
  });

  it("labels a failure with the step that caused it", async () => {
    await assert.rejects(
      () =>
        dbCall("consumeDailyAllowance", async () => {
          throw neonError("42P01", 'relation "rate_buckets" does not exist');
        }),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseError);
        assert.equal(error.step, "consumeDailyAllowance");
        assert.equal(error.schemaBehind, true);
        return true;
      },
    );
  });

  it("keeps the first label when calls are nested", async () => {
    // The inner step is the one that actually failed, so it must survive.
    await assert.rejects(
      () =>
        dbCall("outer", () =>
          dbCall("inner", async () => {
            throw neonError("42703", "column does not exist");
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseError);
        assert.equal(error.step, "inner");
        return true;
      },
    );
  });
});

describe("databaseFailure: a missing table becomes an answer, not a 500", () => {
  it("returns 503 with a body the user can act on", async () => {
    const log = new RequestLog("/api/question", "POST");
    const error = new DatabaseError(
      "consumeDailyAllowance",
      neonError("42P01", 'relation "rate_buckets" does not exist'),
    );

    let response!: Response;
    await captureLogs(async () => {
      response = databaseFailure(log, error)!;
    });

    assert.ok(response, "expected a response, not null");
    assert.equal(response.status, 503);

    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(typeof body.error, "string");
    assert.match(body.error as string, /retrying will not help/i);
    assert.equal(body.requestId, log.requestId);
  });

  it("writes one structured log line naming the step and the SQLSTATE", async () => {
    const log = new RequestLog("/api/question", "POST");
    const error = new DatabaseError(
      "consumeDailyAllowance",
      neonError("42P01", 'relation "rate_buckets" does not exist'),
    );

    const lines = await captureLogs(async () => {
      databaseFailure(log, error);
    });

    assert.equal(lines.length, 1, "exactly one outcome line per request");
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(entry.level, "error");
    assert.equal(entry.route, "/api/question");
    assert.equal(entry.status, 503);
    assert.equal(entry.errorKind, "schema_behind");
    assert.equal(entry.detail, "consumeDailyAllowance failed with 42P01");
    assert.equal(entry.requestId, log.requestId);
  });

  it("never puts the driver's text or the SQL in the response body", async () => {
    const log = new RequestLog("/api/evaluate", "POST");
    const error = new DatabaseError(
      "saveEvaluation",
      neonError("42703", 'column "prompt_version" does not exist'),
    );

    let response!: Response;
    await captureLogs(async () => {
      response = databaseFailure(log, error)!;
    });
    const text = await response.text();

    for (const leak of [
      "rate_buckets",
      "prompt_version",
      "Failed query",
      "insert into",
      "42703",
    ]) {
      assert.ok(
        !text.includes(leak),
        `the response body leaked "${leak}": ${text}`,
      );
    }
  });

  it("separates an unreachable database from a schema that is behind", async () => {
    const log = new RequestLog("/api/vocab", "GET");
    const error = new DatabaseError("listVocab", neonError("08006", "connection lost"));

    let response!: Response;
    const lines = await captureLogs(async () => {
      response = databaseFailure(log, error)!;
    });

    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /try again in a moment/i);
    assert.equal(JSON.parse(lines[0]).errorKind, "database_unavailable");
  });

  it("returns null for anything that is not a database error", () => {
    const log = new RequestLog("/api/question", "POST");
    assert.equal(databaseFailure(log, new Error("gemini exploded")), null);
    assert.equal(databaseFailure(log, "a string"), null);
    assert.equal(databaseFailure(log, null), null);
  });

  it("carries extra fields, so /api/evaluate can still return its sessionId", async () => {
    const log = new RequestLog("/api/evaluate", "POST");
    const error = new DatabaseError("saveEvaluation", neonError("42P01", "gone"));

    let response!: Response;
    await captureLogs(async () => {
      response = databaseFailure(log, error, { sessionId: "abc-123" })!;
    });

    const body = (await response.json()) as { sessionId?: string };
    assert.equal(body.sessionId, "abc-123");
  });
});
