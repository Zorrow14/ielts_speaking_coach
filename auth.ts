import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { ensureUser } from "@/lib/db/users";

/**
 * Single-user lock: only the GitHub accounts whose verified email appears in
 * ALLOWED_EMAILS may sign in. Fails closed - an unset or empty list lets
 * nobody in, which is the safe default for an app with no sign-up flow.
 */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      const allowed = allowedEmails();
      if (allowed.length === 0) {
        console.warn(
          "Sign-in refused: ALLOWED_EMAILS is empty, so no account is permitted.",
        );
        return false;
      }
      return Boolean(email && allowed.includes(email));
    },
    /**
     * Sessions are JWTs (no Auth.js database adapter). On first sign-in we
     * mirror the account into our own `users` table and keep that row's id in
     * the token - it is the user_id every other table references.
     */
    async jwt({ token, user }) {
      if (user?.email) {
        token.appUserId = await ensureUser(user.email);
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.appUserId === "string") {
        session.user.id = token.appUserId;
      }
      return session;
    },
  },
});
