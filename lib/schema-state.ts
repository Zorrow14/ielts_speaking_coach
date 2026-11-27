/**
 * Comparing the migrations a database has applied with the ones this build
 * expects.
 *
 * This is the check that was missing on 27 Nov 2026. Migrations were applied
 * to `dev`, the deployment read `production`, and nothing anywhere compared
 * the two. Code and schema drifted apart across five migrations before anyone
 * noticed, and the way we noticed was a 500 in a browser console.
 *
 * Deliberately pure: it takes the journal and the applied rows as arguments
 * and touches neither the filesystem nor the database. The health route reads
 * the journal with an import; `npm run db:check` reads it with `fs`. Both get
 * the same answer from the same function.
 *
 * drizzle-kit matches a migration to its record by the journal's `when`
 * against the record's `created_at`, not by hash - so that is what is
 * compared here. (Hashes are normalised CRLF to LF before storing, which
 * makes them an unreliable thing to compare from a Windows checkout.)
 */

/** One entry in drizzle/meta/_journal.json. */
export type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

/** One row of drizzle.__drizzle_migrations. `created_at` is a bigint. */
export type AppliedMigration = {
  created_at: number | string | bigint;
};

export type SchemaState = {
  /** Migrations in drizzle/ that this build ships. */
  expected: number;
  /** Migrations the database says it has run. */
  applied: number;
  /** Tags the database is missing, oldest first. The actionable list. */
  missing: string[];
  /**
   * Records in the database with no matching migration file. Means the
   * database is AHEAD of this build - usually an older deployment being
   * rolled back onto a newer schema, which is normally survivable.
   */
  unknown: number;
  /** True when the database is missing something this build needs. */
  behind: boolean;
  inSync: boolean;
};

function toMillis(value: number | string | bigint): number {
  return typeof value === "number" ? value : Number(value);
}

export function compareSchemaState(
  journal: readonly JournalEntry[],
  applied: readonly AppliedMigration[],
): SchemaState {
  const appliedAt = new Set(applied.map((row) => toMillis(row.created_at)));
  const expectedAt = new Set(journal.map((entry) => entry.when));

  const missing = journal
    .filter((entry) => !appliedAt.has(entry.when))
    .sort((a, b) => a.when - b.when)
    .map((entry) => entry.tag);

  const unknown = [...appliedAt].filter((at) => !expectedAt.has(at)).length;

  return {
    expected: journal.length,
    applied: applied.length,
    missing,
    unknown,
    behind: missing.length > 0,
    inSync: missing.length === 0 && unknown === 0,
  };
}

/** A one-line summary safe for a log or a health response. No secrets in it. */
export function describeSchemaState(state: SchemaState): string {
  if (state.inSync) return `in sync (${state.applied}/${state.expected} applied)`;
  if (state.behind) {
    return `behind: ${state.applied}/${state.expected} applied, missing ${state.missing.join(", ")}`;
  }
  return `ahead: ${state.unknown} applied migration(s) not in this build`;
}
