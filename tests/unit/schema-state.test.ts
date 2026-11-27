/**
 * The drift comparison.
 *
 * The case that matters is the one that actually happened: six migrations in
 * the build, two applied in the database, and nothing anywhere noticing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  compareSchemaState,
  describeSchemaState,
  type JournalEntry,
} from "../../lib/schema-state";

const JOURNAL: JournalEntry[] = [
  { idx: 0, tag: "0000_even_sheva_callister", when: 1795697104636 },
  { idx: 1, tag: "0001_great_vin_gonzales", when: 1795698300353 },
  { idx: 2, tag: "0002_happy_magma", when: 1795769476252 },
  { idx: 3, tag: "0003_huge_wendell_rand", when: 1795772847424 },
  { idx: 4, tag: "0004_adorable_chameleon", when: 1795774381622 },
  { idx: 5, tag: "0005_next_skaar", when: 1795776086680 },
];

const applied = (...whens: number[]) => whens.map((created_at) => ({ created_at }));

describe("compareSchemaState", () => {
  it("reproduces the 27 Nov production state", () => {
    // Production had 0000 and 0001 only, while the deployment needed 0005.
    const state = compareSchemaState(
      JOURNAL,
      applied(1795697104636, 1795698300353),
    );

    assert.equal(state.expected, 6);
    assert.equal(state.applied, 2);
    assert.equal(state.behind, true);
    assert.equal(state.inSync, false);
    assert.deepEqual(state.missing, [
      "0002_happy_magma",
      "0003_huge_wendell_rand",
      "0004_adorable_chameleon",
      "0005_next_skaar",
    ]);
  });

  it("calls a fully migrated database in sync", () => {
    const state = compareSchemaState(JOURNAL, applied(...JOURNAL.map((e) => e.when)));
    assert.equal(state.inSync, true);
    assert.equal(state.behind, false);
    assert.deepEqual(state.missing, []);
  });

  it("treats an empty database as behind, not as an error", () => {
    const state = compareSchemaState(JOURNAL, []);
    assert.equal(state.behind, true);
    assert.equal(state.missing.length, 6);
  });

  it("reads a bigint created_at coming back as a string", () => {
    // The Neon driver returns bigint columns as strings. If this comparison
    // used === on mixed types, every migration would look missing.
    const state = compareSchemaState(
      JOURNAL,
      JOURNAL.map((entry) => ({ created_at: String(entry.when) })),
    );
    assert.equal(state.inSync, true, "string timestamps must still match");
  });

  it("reports a database that is ahead without calling it behind", () => {
    // An older build promoted onto a newer schema: survivable, not a fault.
    const state = compareSchemaState(
      JOURNAL.slice(0, 4),
      applied(...JOURNAL.map((e) => e.when)),
    );
    assert.equal(state.behind, false);
    assert.equal(state.unknown, 2);
    assert.equal(state.inSync, false);
  });

  it("lists what is missing oldest first, which is the order to apply them", () => {
    const state = compareSchemaState(JOURNAL, applied(1795697104636));
    assert.deepEqual(state.missing, [
      "0001_great_vin_gonzales",
      "0002_happy_magma",
      "0003_huge_wendell_rand",
      "0004_adorable_chameleon",
      "0005_next_skaar",
    ]);
  });

  it("does not care what order the database returned its rows in", () => {
    const shuffled = applied(...[...JOURNAL.map((e) => e.when)].reverse());
    assert.equal(compareSchemaState(JOURNAL, shuffled).inSync, true);
  });
});

describe("describeSchemaState", () => {
  it("summarises each case in one line, with no secret in it", () => {
    const behind = describeSchemaState(
      compareSchemaState(JOURNAL, applied(1795697104636, 1795698300353)),
    );
    assert.match(behind, /behind: 2\/6 applied/);
    assert.match(behind, /0002_happy_magma/);

    const synced = describeSchemaState(
      compareSchemaState(JOURNAL, applied(...JOURNAL.map((e) => e.when))),
    );
    assert.match(synced, /in sync \(6\/6 applied\)/);

    const ahead = describeSchemaState(
      compareSchemaState(JOURNAL.slice(0, 5), applied(...JOURNAL.map((e) => e.when))),
    );
    assert.match(ahead, /ahead: 1 applied/);
  });
});

describe("the real journal", () => {
  it("is what the health route and db:check both read", () => {
    // Read from disk rather than imported: this suite compiles to CommonJS,
    // and the point is to check the real file either way.
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: JournalEntry[] };

    const entries = journal.entries;
    assert.ok(entries.length > 0, "the journal should list migrations");
    for (const entry of entries) {
      assert.equal(typeof entry.tag, "string");
      assert.equal(typeof entry.when, "number");
    }
    // Monotonic: drizzle-kit decides what to run by comparing timestamps, so
    // an out-of-order journal would silently skip a migration.
    const whens = entries.map((e) => e.when);
    assert.deepEqual(whens, [...whens].sort((a, b) => a - b));
  });
});
