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
     * Gate for middleware. Everything is private except /login and the health
     * check; signed-in visitors to /login are bounced to the home page.
     *
     * API routes get a 401 JSON body rather than a redirect to the HTML login
     * page: a fetch() that silently receives a login page is far harder to
     * diagnose than one that receives "Not signed in." Each route also checks
     * the session itself, so this is defence in depth, not the only gate.
     */
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      // Uptime monitoring needs to reach this without a session. It returns
      // no sensitive detail - see app/api/health/route.ts.
      if (pathname === "/api/health") return true;

      /**
       * Guest mode is public by design, and its own routes do their own
       * gating: a kill switch, a bot check at /api/guest/start, and a signed
       * token on the others. Letting them past this middleware is therefore
       * not a hole - but note that NONE of these paths may read owner data,
       * and none of them do.
       *
       * The privacy and terms pages must be readable before anyone decides
       * to speak into a microphone, so they are public too.
       */
      if (
        pathname === "/guest" ||
        pathname.startsWith("/guest/") ||
        pathname.startsWith("/api/guest/") ||
        pathname === "/privacy" ||
        pathname === "/terms"
      ) {
        return true;
      }

      if (pathname === "/login") {
        return signedIn
          ? Response.redirect(new URL("/", request.nextUrl))
          : true;
      }

      if (!signedIn && pathname.startsWith("/api/")) {
        return Response.json(
          { error: "Not signed in." },
          { status: 401, headers: { "cache-control": "no-store" } },
        );
      }

      return signedIn;
    },
  },
} satisfies NextAuthConfig;
