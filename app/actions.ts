"use server";

/**
 * Server actions callable from client components.
 *
 * Sign-out moved here from an inline action on the home page so the nav - a
 * client component - can offer it too. Behaviour is identical: Auth.js clears
 * the session and redirects to /login. The client only ever holds a reference
 * to this function; auth.ts and everything it imports stay on the server.
 */
import { signOut } from "@/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
