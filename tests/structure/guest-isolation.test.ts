/**
 * The central proof of the guest privacy promise.
 *
 * A runtime spy can only show that a particular call did not write. This walks
 * the IMPORT GRAPH of every guest route and shows that no code path exists
 * which could write - a stronger claim, and one that cannot be defeated by a
 * branch the test happened not to exercise.
 *
 * It is the test most likely to fail usefully later: the day somebody adds a
 * convenient `saveGuestFeedback()` import to a guest route, this goes red and
 * names the chain that got there.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

/** Modules that write owner data. No guest route may reach any of them. */
const FORBIDDEN = [
  join("lib", "db", "queries.ts"),
  join("lib", "db", "vocab.ts"),
  join("lib", "db", "progress.ts"),
];

/** The one database module a guest route is allowed to reach, and via what. */
const ALLOWED_DB_MODULE = join("lib", "db", "index.ts");
const ALLOWED_DB_GATEWAY = join("lib", "guest", "usage.ts");

const GUEST_ROUTES = [
  join("app", "api", "guest", "start", "route.ts"),
  join("app", "api", "guest", "question", "route.ts"),
  join("app", "api", "guest", "evaluate", "route.ts"),
];

/** Resolves one import specifier to a file inside the repo, or null. */
function resolveImport(fromFile: string, specifier: string): string | null {
  // Bare package imports (next, zod, botid, drizzle-orm) are out of scope.
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;

  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Strips comments and string literals.
 *
 * Needed because these checks are about code, not prose. Without it, a file
 * whose comment says "this must never use localStorage" fails the test that
 * nothing uses localStorage - which is how the first run of this suite
 * behaved.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  // Covers `import ... from "x"`, `import "x"`, `export ... from "x"` and
  // dynamic `import("x")`.
  for (const pattern of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Every repo file reachable from `entry`, with the chain that reached it. */
function reachableFrom(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: Array<{ file: string; chain: string[] }> = [
    { file: join(ROOT, entry), chain: [entry] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const rel = relative(ROOT, current.file);
    if (seen.has(rel)) continue;
    seen.set(rel, current.chain);

    for (const specifier of importsOf(current.file)) {
      const resolved = resolveImport(current.file, specifier);
      if (!resolved) continue;
      const resolvedRel = relative(ROOT, resolved);
      if (seen.has(resolvedRel)) continue;
      queue.push({ file: resolved, chain: [...current.chain, resolvedRel] });
    }
  }

  return seen;
}

describe("guest routes cannot reach code that writes owner data", () => {
  it("found the guest routes", () => {
    for (const route of GUEST_ROUTES) {
      assert.ok(existsSync(join(ROOT, route)), `${route} is missing`);
    }
  });

  for (const route of GUEST_ROUTES) {
    it(`${route} reaches no write module`, () => {
      const reachable = reachableFrom(route);

      for (const forbidden of FORBIDDEN) {
        const chain = reachable.get(forbidden);
        assert.equal(
          chain,
          undefined,
          `${route} can reach ${forbidden} via:\n  ${chain?.join("\n  -> ")}`,
        );
      }
    });

    it(`${route} touches the database only through the usage counter`, () => {
      const reachable = reachableFrom(route);
      const dbModules = [...reachable.keys()].filter(
        (file) => file.startsWith(join("lib", "db")) && file.endsWith(".ts"),
      );

      for (const dbModule of dbModules) {
        // schema.ts is table definitions, not writes, and the counter needs it.
        if (dbModule === join("lib", "db", "schema.ts")) continue;
        assert.equal(
          dbModule,
          ALLOWED_DB_MODULE,
          `${route} reaches ${dbModule}; the only permitted database module is ${ALLOWED_DB_MODULE}`,
        );
        const chain = reachable.get(dbModule) ?? [];
        assert.ok(
          chain.includes(ALLOWED_DB_GATEWAY),
          `${route} reaches ${dbModule} without going through ${ALLOWED_DB_GATEWAY}:\n  ${chain.join("\n  -> ")}`,
        );
      }
    });
  }
});

describe("the guest usage module is the only guest code touching the database", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  it("no other lib/guest file imports lib/db", () => {
    for (const file of walk(join(ROOT, "lib", "guest"))) {
      const rel = relative(ROOT, file);
      if (rel === ALLOWED_DB_GATEWAY) continue;
      const specifiers = importsOf(file);
      for (const specifier of specifiers) {
        assert.ok(
          !/(^|\/)db(\/|$)/.test(specifier.replace(/^@\//, "")),
          `${rel} imports "${specifier}"; only ${ALLOWED_DB_GATEWAY} may reach the database`,
        );
      }
    }
  });

  it("the usage module writes only guest_usage", () => {
    const source = readFileSync(join(ROOT, ALLOWED_DB_GATEWAY), "utf8");
    // Every table name it names must be guest_usage.
    // `update X set` rather than bare `update X`: the on-conflict clause
    // contains "do update\n set", which a looser pattern reads as a table
    // called "set".
    const tables = [
      ...source.matchAll(
        /\binsert\s+into\s+(\w+)|\bupdate\s+(\w+)\s+set\b|\bdelete\s+from\s+(\w+)/gi,
      ),
    ].map((match) => match[1] ?? match[2] ?? match[3]);
    assert.ok(tables.length > 0, "found no statements to check");
    for (const table of tables) {
      assert.equal(
        table,
        "guest_usage",
        `the usage module writes to "${table}"`,
      );
    }
    // And the drizzle-style delete must target the same table.
    assert.ok(
      !/\.delete\((?!guestUsage)/.test(source),
      "the usage module deletes from a table other than guestUsage",
    );
  });
});

describe("guest code stores nothing in the browser", () => {
  const GUEST_CLIENT_FILES = [
    join("components", "GuestSession.tsx"),
    join("components", "GuestBotId.tsx"),
    join("app", "guest", "page.tsx"),
  ];

  for (const rel of GUEST_CLIENT_FILES) {
    it(`${rel} uses no browser storage`, () => {
      const source = codeOnly(readFileSync(join(ROOT, rel), "utf8"));
      for (const api of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "openDatabase",
        "document.cookie",
      ]) {
        assert.ok(
          !source.includes(api),
          `${rel} uses ${api}, which guest mode must never do`,
        );
      }
    });
  }

  it("the download is built in the browser, not fetched", () => {
    const source = readFileSync(
      join(ROOT, "components", "GuestSession.tsx"),
      "utf8",
    );
    const code = codeOnly(source);
    assert.ok(code.includes("new Blob("), "expected an in-memory Blob in code");
    assert.ok(source.includes("new Blob("), "expected an in-memory Blob");
    assert.ok(
      source.includes("createObjectURL"),
      "expected the download to use a blob URL",
    );
    // No endpoint exists to produce a report, and none should be called.
    assert.ok(
      !/fetch\([^)]*download/i.test(source),
      "the download must not call the server",
    );
  });
});

describe("guest content never reaches the logs", () => {
  for (const route of GUEST_ROUTES) {
    it(`${route} logs no content`, () => {
      const source = readFileSync(join(ROOT, route), "utf8");
      const code = codeOnly(source);

      // The only logging seam is RequestLog/errorResponse. Bare console calls
      // in a guest route are how a transcript would leak.
      assert.ok(
        !/console\./.test(code),
        `${route} calls console directly; use the RequestLog seam`,
      );

      /**
       * `detail` is the one free-text field that reaches a log line.
       *
       * A quoted literal there is a label we wrote ("missing audio") and is
       * safe by construction. Only an EXPRESSION can carry a guest's content,
       * so literals are skipped and expressions are checked.
       */
      for (const [, value] of source.matchAll(/detail:\s*([^,\n]+)/g)) {
        // Trailing `,` `}` `)` come from the surrounding object literal.
        const expression = value.trim().replace(/[,}){\s]+$/, "");
        const isLiteral =
          /^"[^"]*"$/.test(expression) || /^'[^']*'$/.test(expression);
        if (isLiteral) continue;

        for (const forbidden of [
          "transcript",
          "question",
          "audio",
          "evaluation",
          "view",
          "body",
          "prompt",
        ]) {
          assert.ok(
            !new RegExp(`\\b${forbidden}\\b`, "i").test(expression),
            `${route} logs "${forbidden}" in a detail expression: ${expression}`,
          );
        }
      }
    });
  }
});
