/**
 * Database-backed tests: user isolation, the daily cap under concurrency, and
 * evaluate idempotency.
 *
 * These need a real Postgres, so they SKIP when DATABASE_URL is unset rather
 * than failing - that keeps `npm test` useful without a database, while still
 * running the checks that need one when you have it.
 *
 * They write and then delete two throwaway users. Point DATABASE_URL at a
 * disposable Neon branch, never at production: the cleanup is thorough, but a
 * test that inserts rows has no business running against your real data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../lib/db";
import {
  answers,
  feedback,
  mistakes,
  rateBuckets,
  sessions,
  users,
  vocabNotebook,
} from "../../lib/db/schema";
import { getAnswerByClientToken, getSession, saveEvaluation } from "../../lib/db/queries";
import { addVocab, deleteVocab, listVocab, updateVocab } from "../../lib/db/vocab";
import { consumeDailyAllowance } from "../../lib/rate-limit";
import type { Evaluation } from "../../lib/schemas";
import type { Scored } from "../../lib/scoring";

const HAVE_DB = Boolean(process.env.DATABASE_URL);
const skip = HAVE_DB ? false : "DATABASE_URL is not set";

/** Two users, so "A cannot see B" is a real assertion rather than a wish. */
let userA = "";
let userB = "";

function evaluationFixture(): Evaluation {
  return {
    transcript: "A transcript with enough words in it to be scored normally.",
    fluency: { band: 6, evidence: ["a quote"] },
    lexical: { band: 6, evidence: ["a quote"] },
    grammar: {
      band: 6,
      evidence: ["a quote"],
      sentences_total: 4,
      sentences_with_errors: 1,
      error_types: ["articles"],
    },
    pronunciation: {
      band: 6,
      confidence: "high",
      evidence: ["a word"],
      issues: [],
    },
    filler_notes: [],
    repetition_notes: [],
    strengths: ["Direct answer"],
    next_steps: ["one", "two", "three"],
    mistakes: [
      {
        category: "article",
        original: "a opportunity",
        correction: "an opportunity",
        explanation: "Use an before a vowel sound.",
      },
    ],
  };
}

const scoredFixture: Scored = {
  bands: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6 },
  overall: 6,
  guardrails: [],
};

const provenance = { promptVersion: "test", model: "test-model" };

async function makeUser(label: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ email: `phase5-${label}-${randomUUID()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("could not create the test user");
  return row.id;
}

/** Creates a session plus one marked answer for a user. */
async function seedAnswer(userId: string, clientToken?: string) {
  const db = getDb();
  const [session] = await db
    .insert(sessions)
    .values({ userId, part: 1, topic: "test topic" })
    .returning({ id: sessions.id });
  if (!session) throw new Error("could not create the test session");

  const answerId = await saveEvaluation({
    userId,
    sessionId: session.id,
    question: "A test question?",
    durationSec: 45,
    evaluation: evaluationFixture(),
    scored: scoredFixture,
    provenance,
    clientToken: clientToken ?? null,
  });

  return { sessionId: session.id, answerId };
}

before(async () => {
  if (!HAVE_DB) return;
  userA = await makeUser("a");
  userB = await makeUser("b");
});

after(async () => {
  if (!HAVE_DB) return;
  const db = getDb();
  // Children first where there is no cascade to rely on, then the users;
  // the FKs cascade, but being explicit makes a partial failure obvious.
  for (const userId of [userA, userB].filter(Boolean)) {
    await db.delete(mistakes).where(eq(mistakes.userId, userId));
    await db.delete(feedback).where(eq(feedback.userId, userId));
    await db.delete(vocabNotebook).where(eq(vocabNotebook.userId, userId));
    await db.delete(answers).where(eq(answers.userId, userId));
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(rateBuckets).where(eq(rateBuckets.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe("user isolation", { skip }, () => {
  it("A cannot read B's session", async () => {
    const seeded = await seedAnswer(userB);
    assert.ok(await getSession(seeded.sessionId, userB), "B can read their own");
    assert.equal(
      await getSession(seeded.sessionId, userA),
      null,
      "A must not read B's session",
    );
  });

  it("A cannot read B's answer by its idempotency token", async () => {
    const token = randomUUID();
    await seedAnswer(userB, token);
    assert.ok(await getAnswerByClientToken(userB, token));
    assert.equal(
      await getAnswerByClientToken(userA, token),
      null,
      "A must not read B's answer",
    );
  });

  it("A cannot list B's notebook", async () => {
    await addVocab(userB, { phrase: "B's private phrase" });
    const mine = await listVocab(userA);
    assert.ok(
      !mine.some((entry) => entry.phrase === "B's private phrase"),
      "A must not see B's phrases",
    );
  });

  it("A cannot update B's notebook entry", async () => {
    const entry = await addVocab(userB, { phrase: "do not touch" });
    assert.equal(
      await updateVocab(userA, entry.id, { phrase: "hijacked" }),
      null,
      "the update must not match",
    );
    const [still] = await listVocab(userB, { search: "do not touch" });
    assert.equal(still?.phrase, "do not touch", "B's row must be unchanged");
  });

  it("A cannot delete B's notebook entry", async () => {
    const entry = await addVocab(userB, { phrase: "also do not touch" });
    assert.equal(await deleteVocab(userA, entry.id), false);
    assert.equal(await deleteVocab(userB, entry.id), true);
  });
});

describe("daily cap", { skip }, () => {
  it("cannot be exceeded by parallel requests", async () => {
    const db = getDb();
    const cap = 5;
    process.env.DAILY_REQUEST_CAP = String(cap);
    // Raise the burst limit out of the way; this test is about the day cap.
    process.env.BURST_REQUEST_CAP = "1000";
    const user = await makeUser("race");

    try {
      // Twenty simultaneous claims against a cap of five.
      const results = await Promise.all(
        Array.from({ length: 20 }, () => consumeDailyAllowance(user, "question")),
      );
      const allowed = results.filter((result) => result.allowed).length;

      assert.equal(
        allowed,
        cap,
        `exactly ${cap} requests should be allowed, got ${allowed}`,
      );

      // And the stored counter must agree with what was handed out.
      const [row] = await db
        .select({ used: rateBuckets.used })
        .from(rateBuckets)
        .where(
          and(eq(rateBuckets.userId, user), eq(rateBuckets.kind, "day")),
        );
      assert.equal(row?.used, cap, "the counter must match the grants");

      for (const refused of results.filter((result) => !result.allowed)) {
        assert.equal(refused.allowed, false);
        if (!refused.allowed) assert.equal(refused.limit, "daily");
      }
    } finally {
      await db.delete(rateBuckets).where(eq(rateBuckets.userId, user));
      await db.delete(users).where(eq(users.id, user));
      delete process.env.DAILY_REQUEST_CAP;
      delete process.env.BURST_REQUEST_CAP;
    }
  });

  it("refuses a burst and refunds the daily unit", async () => {
    const db = getDb();
    process.env.DAILY_REQUEST_CAP = "100";
    process.env.BURST_REQUEST_CAP = "2";
    const user = await makeUser("burst");

    try {
      const first = await consumeDailyAllowance(user, "question");
      const second = await consumeDailyAllowance(user, "question");
      const third = await consumeDailyAllowance(user, "question");

      assert.equal(first.allowed, true);
      assert.equal(second.allowed, true);
      assert.equal(third.allowed, false);
      if (!third.allowed) assert.equal(third.limit, "burst");

      // The refused request must not have spent a daily unit.
      const [row] = await db
        .select({ used: rateBuckets.used })
        .from(rateBuckets)
        .where(and(eq(rateBuckets.userId, user), eq(rateBuckets.kind, "day")));
      assert.equal(row?.used, 2, "the burst refusal should have been refunded");
    } finally {
      await db.delete(rateBuckets).where(eq(rateBuckets.userId, user));
      await db.delete(users).where(eq(users.id, user));
      delete process.env.DAILY_REQUEST_CAP;
      delete process.env.BURST_REQUEST_CAP;
    }
  });
});

describe("evaluate idempotency", { skip }, () => {
  it("the same client token cannot create two answers", async () => {
    const db = getDb();
    const token = randomUUID();
    const first = await seedAnswer(userA, token);

    const [session] = await db
      .insert(sessions)
      .values({ userId: userA, part: 1, topic: "second attempt" })
      .returning({ id: sessions.id });
    assert.ok(session);

    await assert.rejects(
      () =>
        saveEvaluation({
          userId: userA,
          sessionId: session.id,
          question: "A test question?",
          durationSec: 45,
          evaluation: evaluationFixture(),
          scored: scoredFixture,
          provenance,
          clientToken: token,
        }),
      "a repeated client token must be rejected by the unique index",
    );

    // And the original is still the one that is found.
    const found = await getAnswerByClientToken(userA, token);
    assert.equal(found?.answerId, first.answerId);

    const [{ count }] = (
      await db.execute(sql`
        select count(*)::int as count from answers
        where user_id = ${userA} and client_token = ${token}
      `)
    ).rows as Array<{ count: number }>;
    assert.equal(count, 1, "exactly one answer should exist for the token");
  });

  it("allows many answers with no token at all", async () => {
    // The unique index is partial, so legacy rows without a token must not
    // collide with each other.
    const one = await seedAnswer(userA);
    const two = await seedAnswer(userA);
    assert.notEqual(one.answerId, two.answerId);
  });
});
