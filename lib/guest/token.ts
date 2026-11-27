/**
 * The guest token.
 *
 * A guest has no account, no password and no row in `users`. The token is the
 * whole identity, and it contains only two things:
 *
 *   gid - 16 random bytes, meaningless on its own
 *   exp - a unix expiry, at most 24 hours out
 *
 * It is signed with HMAC-SHA256 using AUTH_SECRET, which the app already has,
 * so guest mode introduces no new secret. Signing (rather than encrypting)
 * is enough because there is nothing confidential in the payload - the point
 * is that a guest cannot mint themselves a fresh gid to reset their limits,
 * or extend their own expiry.
 *
 * Carried in an httpOnly, secure, sameSite=lax cookie, so page JavaScript
 * cannot read it and it is never in a URL.
 *
 * Deliberately NOT a JWT library: this is two fields and one HMAC, and the
 * verification below is constant-time.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { guestLimits } from "./config";

export const GUEST_COOKIE = "guest_token";

export type GuestToken = { gid: string; exp: number };

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error(
      "AUTH_SECRET is not set; it signs the guest token as well as sessions.",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

/** Mints a token for a brand-new guest. */
export function issueGuestToken(): { value: string; expiresAt: Date; token: GuestToken } {
  const ttlHours = guestLimits().tokenTtlHours;
  const exp = Math.floor(Date.now() / 1000) + ttlHours * 3600;
  const token: GuestToken = { gid: randomBytes(16).toString("base64url"), exp };
  const payload = `${token.gid}.${token.exp}`;
  return {
    value: `${payload}.${sign(payload)}`,
    expiresAt: new Date(exp * 1000),
    token,
  };
}

/**
 * Verifies a token's signature and expiry.
 *
 * Returns null for anything wrong - malformed, tampered, expired, or signed
 * with a different secret - and never says which, because distinguishing them
 * for the caller would help someone probing the format.
 */
export function verifyGuestToken(value: string | undefined | null): GuestToken | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [gid, expRaw, signature] = parts;
  if (!gid || !expRaw || !signature) return null;

  const expected = sign(`${gid}.${expRaw}`);
  // Constant-time: a length mismatch is rejected before comparing bytes,
  // because timingSafeEqual throws on unequal lengths.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp)) return null;
  if (exp * 1000 <= Date.now()) return null;

  // An expiry further out than the policy allows means a token minted under a
  // longer TTL, or a forgery that somehow passed - either way, refuse it.
  const maxExp =
    Math.floor(Date.now() / 1000) + guestLimits().tokenTtlHours * 3600 + 60;
  if (exp > maxExp) return null;

  return { gid, exp };
}

/** Cookie attributes. `secure` is dropped only for local http development. */
export function guestCookieOptions(expiresAt: Date) {
  return {
    name: GUEST_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
