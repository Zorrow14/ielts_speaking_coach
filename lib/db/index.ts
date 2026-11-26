import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Drizzle client over Neon's HTTP driver.
 *
 * Created on first use rather than at import time so that `next build` works
 * on a machine with no DATABASE_URL - the connection is only needed when a
 * request actually touches the database.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
      );
    }
    cached = drizzle(neon(url), { schema });
  }
  return cached;
}

export { schema };
