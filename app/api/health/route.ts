/**
 * Liveness, database connectivity, and whether the schema matches this build.
 *
 * The schema check is the lesson of 27 Nov 2026. A health check that only
 * pings the database answers "ok" while every real route 500s on a missing
 * table, which is worse than no health check at all - it actively reassures
 * you. This one compares the migrations the database has applied against the
 * ones this deployment ships.
 *
 * Deliberately gives away nothing: no connection string, no host, no driver
 * version, no error text. Counts and migration names only - a migration tag
 * like "0004_adorable_chameleon" is in the public repo and tells an attacker
 * nothing they could not read there.
 *
 * Unauthenticated on purpose - a health check that needs a session cannot be
 * used by an uptime monitor - which is exactly why it must stay this thin.
 * Note that Vercel's deployment protection, if enabled, gates it anyway.
 */
import { sql } from "drizzle-orm";
import journal from "@/drizzle/meta/_journal.json";
import { getDb } from "@/lib/db";
import { RequestLog } from "@/lib/log";
import {
  compareSchemaState,
  describeSchemaState,
  type AppliedMigration,
  type JournalEntry,
} from "@/lib/schema-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const log = new RequestLog("/api/health", "GET");
  const startedAt = Date.now();

  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const latencyMs = Date.now() - startedAt;

    /**
     * Read the applied migrations separately, because this query can fail on
     * its own terms: a database that has never been migrated has no
     * drizzle.__drizzle_migrations table at all. That is "behind", not
     * "unreachable" - the connection plainly works, we just got here.
     */
    let applied: AppliedMigration[];
    try {
      const result = await db.execute(
        sql`select created_at from drizzle.__drizzle_migrations order by created_at`,
      );
      applied = result.rows as unknown as AppliedMigration[];
    } catch {
      applied = [];
    }

    const schema = compareSchemaState(
      journal.entries as JournalEntry[],
      applied,
    );

    if (schema.behind) {
      // 503, because the app genuinely cannot serve its routes. A monitor
      // should page for this: no amount of waiting fixes it.
      return log.finish(
        Response.json(
          {
            status: "schema_behind",
            database: "reachable",
            latencyMs,
            schema: {
              expected: schema.expected,
              applied: schema.applied,
              missing: schema.missing,
            },
          },
          { status: 503 },
        ),
        {
          errorKind: "schema_behind",
          detail: describeSchemaState(schema),
        },
      );
    }

    return log.finish(
      Response.json({
        status: "ok",
        database: "reachable",
        latencyMs,
        schema: {
          expected: schema.expected,
          applied: schema.applied,
          // Only ever a count here: an older build against a newer database
          // is normal during a rollback and should not read as a fault.
          ahead: schema.unknown,
        },
      }),
    );
  } catch (error) {
    // The message is logged server-side only; the body says nothing useful
    // to someone probing the endpoint.
    return log.finish(
      Response.json(
        { status: "degraded", database: "unreachable" },
        { status: 503 },
      ),
      {
        errorKind: "database_unreachable",
        detail: error instanceof Error ? error.message : "unknown",
      },
    );
  }
}
