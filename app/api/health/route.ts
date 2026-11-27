/**
 * Liveness and database connectivity.
 *
 * Deliberately gives away nothing: no connection string, no host, no driver
 * version, no error text. Just whether the app can reach Postgres, and how
 * long that took.
 *
 * Unauthenticated on purpose - a health check that needs a session cannot be
 * used by an uptime monitor - which is exactly why it must stay this thin.
 * Note that Vercel's deployment protection, if enabled, gates it anyway.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { RequestLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const log = new RequestLog("/api/health", "GET");
  const startedAt = Date.now();

  try {
    await getDb().execute(sql`select 1`);
    return log.finish(
      Response.json({
        status: "ok",
        database: "reachable",
        latencyMs: Date.now() - startedAt,
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
