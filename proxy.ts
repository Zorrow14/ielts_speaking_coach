import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Next 16 renamed the middleware convention to "proxy".
// Uses the edge-safe config only - no database access here.
export default NextAuth(authConfig).auth;

export const config = {
  // Everything except Auth.js's own endpoints, Next internals and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
