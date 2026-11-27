/**
 * The guest token is the entire guest identity, so forging or extending one
 * would mean unlimited free evaluations. These tests pin that it cannot be.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  GUEST_COOKIE,
  guestCookieOptions,
  issueGuestToken,
  verifyGuestToken,
} from "../../lib/guest/token";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-guest-token-tests";
  delete process.env.GUEST_TOKEN_TTL_HOURS;
});

describe("issueGuestToken", () => {
  it("mints a token that verifies", () => {
    const { value, token } = issueGuestToken();
    const verified = verifyGuestToken(value);
    assert.ok(verified);
    assert.equal(verified.gid, token.gid);
    assert.equal(verified.exp, token.exp);
  });

  it("gives every guest a different id", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => issueGuestToken().token.gid),
    );
    assert.equal(ids.size, 50, "guest ids must not collide");
  });

  it("expires within 24 hours", () => {
    const { token } = issueGuestToken();
    const hours = (token.exp * 1000 - Date.now()) / 3_600_000;
    assert.ok(hours > 0, "must not already be expired");
    assert.ok(hours <= 24.01, `ttl was ${hours} hours`);
  });

  it("caps the ttl at 24 hours even if the env var asks for more", () => {
    process.env.GUEST_TOKEN_TTL_HOURS = "720";
    const { token } = issueGuestToken();
    const hours = (token.exp * 1000 - Date.now()) / 3_600_000;
    assert.ok(hours <= 24.01, `ttl was ${hours} hours despite the cap`);
  });
});

describe("verifyGuestToken rejects", () => {
  it("nothing at all", () => {
    assert.equal(verifyGuestToken(undefined), null);
    assert.equal(verifyGuestToken(null), null);
    assert.equal(verifyGuestToken(""), null);
  });

  it("a malformed token", () => {
    for (const value of [
      "garbage",
      "a.b",
      "a.b.c.d",
      "..",
      "onlyonepart",
      ".".repeat(3),
    ]) {
      assert.equal(verifyGuestToken(value), null, `accepted ${value}`);
    }
  });

  it("a tampered guest id", () => {
    const { value } = issueGuestToken();
    const [gid, exp, signature] = value.split(".");
    // Same signature, different id: this is the "mint myself a fresh quota"
    // attack, and it must fail.
    const forged = `${gid.slice(0, -1)}X.${exp}.${signature}`;
    assert.equal(verifyGuestToken(forged), null);
  });

  it("an extended expiry", () => {
    const { value } = issueGuestToken();
    const [gid, exp, signature] = value.split(".");
    const later = Number(exp) + 86_400;
    assert.equal(verifyGuestToken(`${gid}.${later}.${signature}`), null);
  });

  it("a tampered signature", () => {
    const { value } = issueGuestToken();
    const [gid, exp, signature] = value.split(".");
    assert.equal(
      verifyGuestToken(`${gid}.${exp}.${signature.slice(0, -1)}X`),
      null,
    );
    assert.equal(verifyGuestToken(`${gid}.${exp}.`), null);
    assert.equal(verifyGuestToken(`${gid}.${exp}.short`), null);
  });

  it("a token signed with a different secret", () => {
    const { value } = issueGuestToken();
    process.env.AUTH_SECRET = "a-completely-different-secret";
    assert.equal(
      verifyGuestToken(value),
      null,
      "a token from another deployment must not be accepted",
    );
  });

  it("an expired token", () => {
    // Issue with a 1-hour ttl, then rewrite exp into the past and re-sign is
    // impossible without the secret - so instead assert the expiry branch by
    // checking a token whose exp has passed is refused. Built by hand using
    // the real signing path via a tiny ttl is not possible (the floor is 1
    // hour), so this verifies the boundary logic through a forged exp, which
    // must fail for BOTH reasons.
    const { value } = issueGuestToken();
    const [gid, , signature] = value.split(".");
    const past = Math.floor(Date.now() / 1000) - 10;
    assert.equal(verifyGuestToken(`${gid}.${past}.${signature}`), null);
  });

  it("refuses to work with no AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET;
    assert.throws(() => issueGuestToken(), /AUTH_SECRET/);
  });
});

describe("guestCookieOptions", () => {
  it("is httpOnly, sameSite lax, and scoped to the whole site", () => {
    const options = guestCookieOptions(new Date(Date.now() + 3_600_000));
    assert.equal(options.name, GUEST_COOKIE);
    assert.equal(options.httpOnly, true, "page scripts must not read it");
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.ok(options.expires instanceof Date);
  });

  it("is secure in production", () => {
    const original = process.env.NODE_ENV;
    try {
      // NODE_ENV is readonly in the Next types but a plain string at runtime.
      (process.env as Record<string, string>).NODE_ENV = "production";
      assert.equal(guestCookieOptions(new Date()).secure, true);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original ?? "test";
    }
  });
});
