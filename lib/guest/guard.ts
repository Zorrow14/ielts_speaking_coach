/**
 * Shared entry checks for the guest routes.
 *
 * Every guest route starts with `openGuestRoute`, which enforces, in order:
 *
 *   1. the kill switch - when off, the route 404s as though it did not exist,
 *      rather than 403ing, because a disabled feature should not advertise
 *      itself;
 *   2. a valid, unexpired, correctly signed guest token.
 *
 * The bot check lives in /api/guest/start only. Running it on every request
 * would be the stricter choice, but BotID's client challenge is attached per
 * protected path and the token is already unforgeable - so the gate is at the
 * door, and the token is what gets you back in.
 *
 * This module imports nothing from lib/db except through lib/guest/usage.
 */
import { cookies } from "next/headers";
import { guestModeEnabled } from "./config";
import { GUEST_COOKIE, verifyGuestToken, type GuestToken } from "./token";

export type GuestGate =
  | { ok: true; token: GuestToken }
  | { ok: false; status: number; message: string; kind: string };

export async function openGuestRoute(): Promise<GuestGate> {
  if (!guestModeEnabled()) {
    return {
      ok: false,
      status: 404,
      kind: "guest_disabled",
      message: "Not found.",
    };
  }

  const jar = await cookies();
  const token = verifyGuestToken(jar.get(GUEST_COOKIE)?.value);
  if (!token) {
    return {
      ok: false,
      status: 401,
      kind: "guest_token_invalid",
      // One message for missing, malformed, tampered and expired alike.
      message:
        "Your guest session has expired or is not valid. Reload the page to start a new one.",
    };
  }

  return { ok: true, token };
}
