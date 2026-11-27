/**
 * The kill switch and the limits. The switch failing open would expose a paid
 * AI endpoint to the internet, so its default is the single most important
 * assertion in this file.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  geminiPaidTier,
  guestLimits,
  guestModeEnabled,
  maxRecordingSec,
} from "../../lib/guest/config";
import { hashSubject } from "../../lib/guest/usage";

const GUEST_VARS = [
  "GUEST_MODE_ENABLED",
  "GEMINI_PAID_TIER",
  "GUEST_EVALUATIONS_PER_TOKEN",
  "GUEST_QUESTIONS_PER_TOKEN",
  "GUEST_EVALUATIONS_PER_IP",
  "GUEST_GLOBAL_EVALUATIONS",
  "GUEST_TOKEN_TTL_HOURS",
  "GUEST_MAX_SEC_PART13",
  "GUEST_MAX_SEC_PART2",
  "GUEST_MAX_AUDIO_BYTES",
];

beforeEach(() => {
  for (const name of GUEST_VARS) delete process.env[name];
  process.env.AUTH_SECRET = "test-secret-for-guest-config-tests";
});

describe("the kill switch", () => {
  it("is OFF when the variable is unset", () => {
    assert.equal(
      guestModeEnabled(),
      false,
      "guest mode must fail closed, like ALLOWED_EMAILS",
    );
  });

  it("only opens for an explicit true", () => {
    for (const value of ["true", "TRUE", "True", "1"]) {
      process.env.GUEST_MODE_ENABLED = value;
      assert.equal(guestModeEnabled(), true, `${value} should enable`);
    }
    for (const value of ["false", "no", "yes", "", "0", "maybe", "on"]) {
      process.env.GUEST_MODE_ENABLED = value;
      assert.equal(guestModeEnabled(), false, `${value} should NOT enable`);
    }
  });
});

describe("the paid-tier flag", () => {
  it("defaults to false, so the privacy page tells the harsher truth", () => {
    assert.equal(geminiPaidTier(), false);
  });
});

describe("guestLimits", () => {
  it("has the documented defaults", () => {
    const limits = guestLimits();
    assert.equal(limits.evaluationsPerToken, 3);
    assert.equal(limits.questionsPerToken, 10);
    assert.equal(limits.evaluationsPerIp, 5);
    assert.equal(limits.globalEvaluations, 100);
    assert.equal(limits.tokenTtlHours, 24);
    assert.equal(limits.maxRecordingSecPart13, 90);
    assert.equal(limits.maxRecordingSecPart2, 120);
  });

  it("is overridable", () => {
    process.env.GUEST_EVALUATIONS_PER_TOKEN = "1";
    process.env.GUEST_GLOBAL_EVALUATIONS = "7";
    const limits = guestLimits();
    assert.equal(limits.evaluationsPerToken, 1);
    assert.equal(limits.globalEvaluations, 7);
  });

  it("ignores nonsense rather than disabling a limit", () => {
    // A typo must not become "unlimited".
    for (const value of ["0", "-5", "abc", "", "  ", "null", "Infinity"]) {
      process.env.GUEST_EVALUATIONS_PER_TOKEN = value;
      assert.equal(
        guestLimits().evaluationsPerToken,
        3,
        `"${value}" should fall back to the default`,
      );
    }
  });

  it("never turns a malformed number into a LARGER limit", () => {
    // parseInt reads leading digits, so "1.5e400" becomes 1 and "12abc"
    // becomes 12. That is acceptable precisely because it can only ever
    // produce a number, never "unlimited" - which is the property worth
    // pinning. A tighter-than-intended limit is a safe failure.
    for (const value of ["1.5e400", "12abc", "3.9", "07"]) {
      process.env.GUEST_EVALUATIONS_PER_TOKEN = value;
      const limit = guestLimits().evaluationsPerToken;
      assert.ok(
        Number.isInteger(limit) && limit > 0 && limit < 1000,
        `"${value}" produced ${limit}`,
      );
    }
  });

  it("caps the token ttl at 24 hours whatever the env says", () => {
    process.env.GUEST_TOKEN_TTL_HOURS = "9999";
    assert.equal(guestLimits().tokenTtlHours, 24);
  });
});

describe("maxRecordingSec", () => {
  it("gives Part 2 the longer ceiling", () => {
    assert.equal(maxRecordingSec(1), 90);
    assert.equal(maxRecordingSec(3), 90);
    assert.equal(maxRecordingSec(2), 120);
  });
});

describe("hashSubject", () => {
  it("is stable within a day", () => {
    assert.equal(
      hashSubject("guest-abc", "2026-11-27"),
      hashSubject("guest-abc", "2026-11-27"),
    );
  });

  it("produces an unrelated hash on a different day", () => {
    // This is the property that stops counters being joined across days to
    // build a history of anyone.
    const today = hashSubject("guest-abc", "2026-11-27");
    const tomorrow = hashSubject("guest-abc", "2026-11-28");
    assert.notEqual(today, tomorrow);
  });

  it("separates different subjects on the same day", () => {
    assert.notEqual(
      hashSubject("guest-abc", "2026-11-27"),
      hashSubject("guest-xyz", "2026-11-27"),
    );
  });

  it("does not leak the input", () => {
    const hash = hashSubject("203.0.113.42", "2026-11-27");
    assert.ok(!hash.includes("203"), "the hash must not contain the input");
    assert.ok(!hash.includes("113"));
    assert.equal(hash.length, 32);
  });

  it("changes when the secret changes", () => {
    const before = hashSubject("guest-abc", "2026-11-27");
    process.env.AUTH_SECRET = "another-secret";
    assert.notEqual(before, hashSubject("guest-abc", "2026-11-27"));
  });
});
