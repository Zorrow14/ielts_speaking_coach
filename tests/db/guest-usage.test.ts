/**
 * Guest counters against a real database.
 *
 * The important one is the last suite: it runs the counter path and then
 * compares the row count of EVERY table before and after, asserting that only
 * guest_usage moved. That is the "an inspection of the database shows only
 * anonymous counters" claim, checked rather than asserted.
 *
 * Skips when DATABASE_URL is unset. Point it at a disposable branch.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../lib/db";
import { guestUsage } from "../../lib/db/schema";
import {
  claimGuestEvaluation,
  claimGuestQuestion,
  hashSubject,
} from "../../lib/guest/usage";

const HAVE_DB = Boolean(process.env.DATABASE_URL);
const skip = HAVE_DB ? false : "DATABASE_URL is not set";

/** Guest ids created by this run, so cleanup only removes our own rows. */
const createdSubjects: string[] = [];

function newGuest(): string {
  const gid = `test-${randomUUID()}`;
  createdSubjects.push(hashSubject(gid));
  return gid;
}

beforeEach(() => {
  process.env.AUTH_SECRET =
    process.env.AUTH_SECRET ?? "test-secret-for-guest-db-tests";
});

after(async () => {
  if (!HAVE_DB) return;
  const db = getDb();
  for (const subject of createdSubjects) {
    await db.delete(guestUsage).where(eq(guestUsage.subject, subject));
  }
  // The shared budget row and any ip rows this run created.
  await db.delete(guestUsage).where(eq(guestUsage.subject, "global"));
});

describe("guest question limit", { skip }, () => {
  it("cannot be exceeded by parallel requests", async () => {
    process.env.GUEST_QUESTIONS_PER_TOKEN = "4";
    const gid = newGuest();
    try {
      const results = await Promise.all(
        Array.from({ length: 15 }, () => claimGuestQuestion(gid)),
      );
      const allowed = results.filter((result) => result.allowed).length;
      assert.equal(allowed, 4, `expected 4 allowed, got ${allowed}`);
      for (const refused of results.filter((r) => !r.allowed)) {
        if (!refused.allowed) assert.equal(refused.kind, "token_questions");
      }
    } finally {
      delete process.env.GUEST_QUESTIONS_PER_TOKEN;
    }
  });
});

describe("guest evaluation limits", { skip }, () => {
  it("cannot be exceeded by parallel requests", async () => {
    process.env.GUEST_EVALUATIONS_PER_TOKEN = "3";
    process.env.GUEST_EVALUATIONS_PER_IP = "100";
    process.env.GUEST_GLOBAL_EVALUATIONS = "100";
    const gid = newGuest();
    const ipHash = hashSubject(`ip:test-${randomUUID()}`);
    createdSubjects.push(ipHash);

    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          claimGuestEvaluation({ gid, ipHash }),
        ),
      );
      const allowed = results.filter((result) => result.allowed).length;
      assert.equal(allowed, 3, `expected 3 allowed, got ${allowed}`);
    } finally {
      delete process.env.GUEST_EVALUATIONS_PER_TOKEN;
      delete process.env.GUEST_EVALUATIONS_PER_IP;
      delete process.env.GUEST_GLOBAL_EVALUATIONS;
    }
  });

  it("stops at the IP limit even with a fresh token", async () => {
    // The point of the IP limit: clearing cookies must not reset the quota.
    process.env.GUEST_EVALUATIONS_PER_TOKEN = "100";
    process.env.GUEST_EVALUATIONS_PER_IP = "2";
    process.env.GUEST_GLOBAL_EVALUATIONS = "100";
    const ipHash = hashSubject(`ip:test-${randomUUID()}`);
    createdSubjects.push(ipHash);

    try {
      const first = await claimGuestEvaluation({ gid: newGuest(), ipHash });
      const second = await claimGuestEvaluation({ gid: newGuest(), ipHash });
      const third = await claimGuestEvaluation({ gid: newGuest(), ipHash });

      assert.equal(first.allowed, true);
      assert.equal(second.allowed, true);
      assert.equal(third.allowed, false);
      if (!third.allowed) assert.equal(third.kind, "ip_evaluations");
    } finally {
      delete process.env.GUEST_EVALUATIONS_PER_TOKEN;
      delete process.env.GUEST_EVALUATIONS_PER_IP;
      delete process.env.GUEST_GLOBAL_EVALUATIONS;
    }
  });

  it("stops at the global budget and refunds the other counters", async () => {
    process.env.GUEST_EVALUATIONS_PER_TOKEN = "100";
    process.env.GUEST_EVALUATIONS_PER_IP = "100";
    process.env.GUEST_GLOBAL_EVALUATIONS = "2";
    const db = getDb();
    const gid = newGuest();
    const tokenSubject = hashSubject(gid);
    const ipHash = hashSubject(`ip:test-${randomUUID()}`);
    createdSubjects.push(ipHash);

    try {
      await db.delete(guestUsage).where(eq(guestUsage.subject, "global"));

      assert.equal((await claimGuestEvaluation({ gid, ipHash })).allowed, true);
      assert.equal((await claimGuestEvaluation({ gid, ipHash })).allowed, true);
      const third = await claimGuestEvaluation({ gid, ipHash });
      assert.equal(third.allowed, false);
      if (!third.allowed) assert.equal(third.kind, "global_budget");

      // The refused request must not have spent the guest's own allowance.
      const [row] = await db
        .select({ count: guestUsage.count })
        .from(guestUsage)
        .where(eq(guestUsage.subject, tokenSubject));
      assert.equal(
        row?.count,
        2,
        "the global refusal should not have consumed a token unit",
      );
    } finally {
      delete process.env.GUEST_EVALUATIONS_PER_TOKEN;
      delete process.env.GUEST_EVALUATIONS_PER_IP;
      delete process.env.GUEST_GLOBAL_EVALUATIONS;
    }
  });
});

describe("guest usage writes nothing but counters", { skip }, () => {
  /** Row counts for every table in the public schema. */
  async function tableCounts(): Promise<Map<string, number>> {
    const db = getDb();
    const tables = (
      await db.execute(sql`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
      `)
    ).rows as Array<{ table_name: string }>;

    const counts = new Map<string, number>();
    for (const { table_name } of tables) {
      const result = await db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table_name)}`,
      );
      const row = result.rows[0] as { n: number };
      counts.set(table_name, Number(row.n));
    }
    return counts;
  }

  it("touches only guest_usage", async () => {
    const before = await tableCounts();
    assert.ok(before.size >= 8, `only found ${before.size} tables`);

    const gid = newGuest();
    const ipHash = hashSubject(`ip:test-${randomUUID()}`);
    createdSubjects.push(ipHash);
    await claimGuestQuestion(gid);
    await claimGuestEvaluation({ gid, ipHash });

    const after = await tableCounts();

    for (const [table, countBefore] of before) {
      const countAfter = after.get(table) ?? 0;
      if (table === "guest_usage") {
        assert.ok(
          countAfter > countBefore,
          "guest_usage should have gained rows",
        );
        continue;
      }
      assert.equal(
        countAfter,
        countBefore,
        `"${table}" changed from ${countBefore} to ${countAfter}; guest traffic must only touch guest_usage`,
      );
    }
  });

  it("stores no content in the rows it does write", async () => {
    const db = getDb();
    const gid = newGuest();
    await claimGuestQuestion(gid);

    const rows = (
      await db.execute(sql`select * from guest_usage limit 50`)
    ).rows as Array<Record<string, unknown>>;

    assert.ok(rows.length > 0, "expected at least one counter row");
    for (const row of rows) {
      // Exactly four columns, and nothing that could hold text content.
      assert.deepEqual(
        Object.keys(row).sort(),
        ["count", "day", "endpoint", "subject"],
        "guest_usage has gained a column",
      );
      assert.equal(typeof row.count, "number");
      // The subject must be a hash, not anything readable.
      const subject = String(row.subject);
      assert.ok(
        subject === "global" || /^[A-Za-z0-9_-]{32}$/.test(subject),
        `subject "${subject}" does not look like a hash`,
      );
      assert.ok(
        !subject.includes("@") && !subject.includes("."),
        "subject looks like an email or an IP",
      );
    }
  });
});
