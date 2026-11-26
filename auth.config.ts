import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Edge-safe half of the Auth.js config: no database imports, so middleware
 * stays small. The database callbacks live in auth.ts.
 */
export const authConfig = {
  providers: [GitHub],
  pages: { signIn: "/login" },
  callbacks: {
    /**
     * Gate for middleware. Everything is private except /login; signed-in
     * visitors to /login are bounced to the home page.
     */
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user);
      if (request.nextUrl.pathname === "/login") {
        return signedIn
          ? Response.redirect(new URL("/", request.nextUrl))
          : true;
      }
      return signedIn;
    },
  },
} satisfies NextAuthConfig;
