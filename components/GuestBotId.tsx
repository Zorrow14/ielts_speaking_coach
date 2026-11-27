"use client";

/**
 * Attaches Vercel BotID's invisible challenge to the guest start endpoint.
 *
 * Rendered only on the pages a guest can reach, not in the root layout: the
 * owner's pages have no use for it, and loading a bot-detection script on
 * every authenticated page would be pointless weight.
 *
 * The challenge is invisible - there is no widget and nothing for a person to
 * solve. The verdict is read server-side by checkBotId() in
 * app/api/guest/start/route.ts.
 */
import { BotIdClient } from "botid/client";

export default function GuestBotId() {
  return (
    <BotIdClient
      protect={[{ path: "/api/guest/start", method: "POST" }]}
    />
  );
}
