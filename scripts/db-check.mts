/**
 * `npm run db:check` - is the DATABASE_URL target running the migrations this
 * build expects?
 *
 * Run it before every deploy, and against production specifically. The whole
 * reason it exists is that on 27 Nov 2026 nothing did: migrations went to
 * `dev`, the deployment read `production`, and the gap only surfaced as a 500
 * in a browser.
 *
 *   npm run db:check                 # whatever .env.local points at
 *   $env:DATABASE_URL = "..."        # or an explicit target, in a throwaway shell
 *   npm run db:check
 *
 * Exit codes: 0 in sync (or merely ahead), 1 behind, 2 could not check.
 *
 * Prints migration NAMES and COUNTS only. It never prints the connection
 * string, the host, or any part of a credential - the one thing you must be
 * able to trust about a command people paste into CI.
 *
 * Runs on Node's native TypeScript support (22.18+ / 24+), like the rest of
 * the tooling here, so it needs no build step and no new dependency.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  compareSchemaState,
  describeSchemaState,
  type AppliedMigration,
  type JournalEntry,
} from "../lib/schema-state.ts";

const ROOT = process.cwd();

// Same loading order as drizzle.config.ts: an explicit DATABASE_URL in the
// shell wins, because Node's loadEnvFile does not overwrite what is already
// set. That is what makes targeting production a one-line override.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local; the environment is expected to carry DATABASE_URL.
}

function fail(message: string, code: number): never {
  console.error(`db:check: ${message}`);
  process.exit(code);
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail("DATABASE_URL is not set, so there is nothing to check.", 2);
}

const journal = JSON.parse(
  readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

let applied: AppliedMigration[];
try {
  const sql = neon(url);
  applied = (await sql`
    select created_at from drizzle.__drizzle_migrations order by created_at
  `) as AppliedMigration[];
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  // A missing migrations table means nothing has ever been applied here,
  // which is a legitimate answer rather than a failure to check.
  if (/__drizzle_migrations|does not exist/i.test(message)) {
    applied = [];
  } else {
    // The driver's message can contain the host. Say that it failed, not how.
    fail("could not reach the database. Check DATABASE_URL and the branch.", 2);
  }
}

const state = compareSchemaState(journal.entries, applied);

const appliedAt = new Set(applied.map((row) => Number(row.created_at)));
console.log(`\n  migrations in drizzle/ : ${state.expected}`);
console.log(`  applied in database    : ${state.applied}\n`);
for (const entry of [...journal.entries].sort((a, b) => a.when - b.when)) {
  const mark = appliedAt.has(entry.when) ? "applied" : "MISSING";
  console.log(`  ${mark.padEnd(8)} ${entry.tag}`);
}
if (state.unknown > 0) {
  console.log(
    `\n  ${state.unknown} applied migration(s) are not in this build - the database is ahead.`,
  );
}
console.log(`\n  ${describeSchemaState(state)}\n`);

if (state.behind) {
  console.error(
    "  The database is BEHIND this build. Deploying now gives you routes that\n" +
      "  500 on a missing table or column. Run `npm run db:migrate` against this\n" +
      "  target first. See DEPLOY.md section 4.\n",
  );
  process.exit(1);
}

if (state.unknown > 0) {
  console.log(
    "  Ahead is usually fine - an older build against a newer schema ignores\n" +
      "  the columns it does not know about. Not an error.\n",
  );
}

process.exit(0);
