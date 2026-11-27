/**
 * Structural audit, run as a test so it cannot quietly rot.
 *
 * These are not unit tests of behaviour: they read the source and assert
 * properties the whole codebase must hold. That catches the class of mistake
 * that behavioural tests miss - a NEW route added later without an auth check,
 * or a query written without a user_id filter.
 *
 * It is a coarse check by nature. A route could satisfy it and still be wrong.
 * It exists to make the obvious failure impossible to merge, not to prove
 * correctness.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".next", ".git", ".calibration", ".testbuild"].includes(entry)) {
        continue;
      }
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(join(ROOT, "app"))
  .concat(walk(join(ROOT, "lib")))
  .concat(walk(join(ROOT, "components")));

const ROUTE_FILES = ALL_FILES.filter((file) => file.endsWith(`${sep}route.ts`));

/** Auth.js owns its own route; it has no session of its own to check. */
const AUTH_HANDLER = join("app", "api", "auth");
/** Deliberately public, and documented as returning nothing sensitive. */
const PUBLIC_ROUTES = [join("app", "api", "health", "route.ts")];

describe("every API route is authenticated", () => {
  it("found the routes to check", () => {
    assert.ok(ROUTE_FILES.length >= 7, `only found ${ROUTE_FILES.length} routes`);
  });

  for (const file of ROUTE_FILES) {
    const rel = relative(ROOT, file);
    if (rel.startsWith(AUTH_HANDLER)) continue;

    it(rel, () => {
      const source = readFileSync(file, "utf8");

      if (PUBLIC_ROUTES.includes(rel)) {
        // A public route must not read user data at all.
        assert.ok(
          !/\buserId\b/.test(source),
          `${rel} is public but mentions userId`,
        );
        return;
      }

      // Either the route calls auth() itself, or it goes through the local
      // currentUserId() helper, which does.
      assert.ok(
        /\bawait auth\(\)/.test(source) || /currentUserId\(\)/.test(source),
        `${rel} never resolves a session`,
      );
      // And it must refuse when there is none.
      assert.ok(
        /401/.test(source),
        `${rel} has no 401 path for an unauthenticated caller`,
      );
    });
  }
});

describe("data access always filters by user", () => {
  const DATA_FILES = [
    join("lib", "db", "queries.ts"),
    join("lib", "db", "progress.ts"),
    join("lib", "db", "vocab.ts"),
  ];

  for (const rel of DATA_FILES) {
    it(rel, () => {
      const source = readFileSync(join(ROOT, rel), "utf8");
      const userIdMentions = source.match(/userId/g)?.length ?? 0;
      assert.ok(
        userIdMentions > 5,
        `${rel} barely mentions userId (${userIdMentions} times)`,
      );
    });
  }

  it("every exported query takes a userId", () => {
    // Catches a query added later that reads a table without scoping it.
    for (const rel of DATA_FILES) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      const exported = [...source.matchAll(/export async function (\w+)\(([^)]*)\)/gs)];
      assert.ok(exported.length > 0, `${rel} exports no queries`);
      for (const [, name, params] of exported) {
        assert.ok(
          /userId/.test(params),
          `${rel}: ${name}() does not take a userId`,
        );
      }
    }
  });
});

describe("secrets stay on the server", () => {
  const CLIENT_FILES = ALL_FILES.filter(
    (file) =>
      (file.endsWith(".tsx") || file.endsWith(".ts")) &&
      /^\s*"use client"/m.test(readFileSync(file, "utf8")),
  );

  it("found the client components", () => {
    assert.ok(CLIENT_FILES.length >= 5);
  });

  for (const file of CLIENT_FILES) {
    const rel = relative(ROOT, file);
    it(`${rel} holds no server secret`, () => {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "GEMINI_API_KEY",
        "DATABASE_URL",
        "AUTH_SECRET",
        "AUTH_GITHUB_SECRET",
        "ALLOWED_EMAILS",
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `${rel} references ${forbidden}`,
        );
      }
      assert.ok(
        !/lib\/gemini/.test(source),
        `${rel} imports the Gemini module, which holds the API key`,
      );
    });
  }

  it("no NEXT_PUBLIC_ variable exists at all", () => {
    for (const file of ALL_FILES) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !source.includes("NEXT_PUBLIC_"),
        `${relative(ROOT, file)} uses a NEXT_PUBLIC_ variable`,
      );
    }
  });

  it(".env.example carries names only, never values", () => {
    const source = readFileSync(join(ROOT, ".env.example"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const [name, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      // Non-secret defaults are fine; anything that looks like a credential
      // is not.
      const isSecret = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/i.test(name);
      if (isSecret) {
        assert.equal(value, "", `${name} has a value in .env.example`);
      }
    }
  });
});

describe("audio and learner text never reach the logs", () => {
  it("no log call passes audio, a transcript or a prompt", () => {
    for (const file of ALL_FILES) {
      const rel = relative(ROOT, file);
      if (rel.startsWith(join("lib", "log.ts"))) continue;
      const source = readFileSync(file, "utf8");
      const logCalls = [...source.matchAll(/console\.\w+\(([^;]*)\)/gs)];
      for (const [call] of logCalls) {
        for (const forbidden of [
          "audio",
          "transcript",
          "blob",
          "prompt",
          "systemInstruction",
          "apiKey",
        ]) {
          assert.ok(
            !new RegExp(`\\b${forbidden}\\b`, "i").test(call),
            `${rel} logs something named "${forbidden}"`,
          );
        }
      }
    }
  });

  it("audio is never written to the database", () => {
    const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
    // Column NAMES only. The prose in that file says "audio is never stored",
    // so matching comments would fail on its own documentation.
    const columnNames = [
      ...schema.matchAll(
        /\b(?:text|uuid|integer|smallint|numeric|jsonb|timestamp|boolean)\(\s*"([^"]+)"/g,
      ),
    ].map(([, name]) => name);

    assert.ok(columnNames.length > 20, "found too few columns to be checking");
    for (const forbidden of ["audio", "bytes", "blob", "recording", "sound"]) {
      const offender = columnNames.find((name) =>
        name.toLowerCase().includes(forbidden),
      );
      assert.equal(
        offender,
        undefined,
        `a column is named "${offender}", which suggests audio is being stored`,
      );
    }
  });

  it("no route writes to the filesystem", () => {
    for (const file of ROUTE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !/node:fs|require\("fs"\)|writeFile|createWriteStream/.test(source),
        `${relative(ROOT, file)} touches the filesystem`,
      );
    }
  });
});

describe("security configuration", () => {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");

  it("sets the headers that matter", () => {
    for (const header of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      assert.ok(config.includes(header), `${header} is not set`);
    }
  });

  it("hides the framework version", () => {
    assert.match(config, /poweredByHeader:\s*false/);
  });

  it("keeps the browser away from Gemini and the database", () => {
    assert.match(config, /connect-src 'self'/);
  });

  it("locks the sign-in allowlist closed by default", () => {
    const authSource = readFileSync(join(ROOT, "auth.ts"), "utf8");
    // An empty ALLOWED_EMAILS must refuse everybody, not admit everybody.
    assert.match(authSource, /allowed\.length === 0/);
    assert.match(authSource, /return false/);
  });
});
