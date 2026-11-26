import { eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import { users } from "./schema";

/**
 * Returns the id of the `users` row for this email, creating it on first
 * sign-in. Emails are stored and compared lower-cased, matching the
 * users_email_lower_idx unique index.
 */
export async function ensureUser(email: string): Promise<string> {
  const db = getDb();
  const normalised = email.toLowerCase();

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalised))
    .limit(1);
  if (found[0]) return found[0].id;

  const inserted = await db
    .insert(users)
    .values({ email: normalised })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (inserted[0]) return inserted[0].id;

  // Lost a race against a concurrent sign-in; the row exists now.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalised))
    .limit(1);
  if (existing[0]) return existing[0].id;

  throw new Error("Could not create or find the user row for this account.");
}
