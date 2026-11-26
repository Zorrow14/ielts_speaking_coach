import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so load .env.local the same way Next would.
// process.loadEnvFile is built into Node 20.12+; no dotenv dependency needed.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local - fall back to whatever is already in the environment.
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
