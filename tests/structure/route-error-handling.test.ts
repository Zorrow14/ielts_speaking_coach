/**
 * The shape rule that the 27 Nov 2026 incident taught us.
 *
 * `/api/question` called `consumeDailyAllowance()` BEFORE its try block. When
 * production turned out to be five migrations behind, that call threw, the
 * throw escaped the handler, and the user got a bare 500 with no log line and
 * no clue. Every other route had the same pattern waiting to happen.
 *
 * The rule, asserted below: in an exported route handler, nothing is awaited
 * until error handling is in place. Reading source is a blunt instrument, but
 * it is the only check that applies to a route written next month by someone
 * who never read this file.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ROUTE_FILES = walk(join(ROOT, "app", "api")).filter(
  (file) =>
    file.endsWith(`${sep}route.ts`) &&
    // Auth.js exports its own handlers; there is no body of ours to check.
    !relative(ROOT, file).includes(join("api", "auth")),
);

/** Strips comments and string literals so prose cannot match as code. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => `\`${" ".repeat(Math.max(0, m.length - 2))}\``)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${" ".repeat(Math.max(0, m.length - 2))}"`)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${" ".repeat(Math.max(0, m.length - 2))}'`);
}

/** The body of a function, from its opening brace to the matching close. */
function bodyFrom(code: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(openBraceIndex + 1, i);
    }
  }
  return code.slice(openBraceIndex + 1);
}

type Handler = { name: string; body: string };

function exportedHandlers(code: string): Handler[] {
  const handlers: Handler[] = [];
  const pattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  for (const match of code.matchAll(pattern)) {
    const brace = code.indexOf("{", match.index + match[0].length);
    if (brace === -1) continue;
    handlers.push({ name: match[1], body: bodyFrom(code, brace) });
  }
  return handlers;
}

describe("no route awaits anything before it can handle a failure", () => {
  it("found the routes to check", () => {
    assert.ok(ROUTE_FILES.length >= 6, `only found ${ROUTE_FILES.length} routes`);
  });

  for (const file of ROUTE_FILES) {
    const rel = relative(ROOT, file);
    const code = codeOnly(readFileSync(file, "utf8"));
    const handlers = exportedHandlers(code);

    it(`${rel} exports at least one handler`, () => {
      assert.ok(handlers.length > 0, `no exported handler found in ${rel}`);
    });

    for (const handler of handlers) {
      it(`${rel} ${handler.name}() opens its try before its first await`, () => {
        const firstAwait = handler.body.search(/\bawait\b/);
        if (firstAwait === -1) return; // nothing async to protect

        const firstTry = handler.body.search(/\btry\s*\{/);
        assert.notEqual(
          firstTry,
          -1,
          `${rel} ${handler.name}() awaits without any try block`,
        );
        assert.ok(
          firstTry < firstAwait,
          `${rel} ${handler.name}() awaits at offset ${firstAwait} but does not open a try until ${firstTry}. ` +
            `A failure in that call escapes the handler and becomes a bare 500 - this is exactly the 27 Nov 2026 bug.`,
        );
      });
    }
  }
});

describe("every route that touches the database can classify a database failure", () => {
  for (const file of ROUTE_FILES) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, "utf8");
    const code = codeOnly(source);

    const touchesDatabase =
      /@\/lib\/db/.test(code) || /@\/lib\/rate-limit/.test(code);
    if (!touchesDatabase) continue;

    it(`${rel} imports and uses databaseFailure`, () => {
      assert.ok(
        /databaseFailure/.test(code),
        `${rel} reads or writes the database but never calls databaseFailure, so a missing table becomes a 500`,
      );
    });

    it(`${rel} checks databaseFailure in every catch that classifies errors`, () => {
      // Each exported handler's outermost catch must consult it first.
      for (const handler of exportedHandlers(code)) {
        if (!/\bawait\b/.test(handler.body)) continue;
        assert.ok(
          /databaseFailure\s*\(/.test(handler.body),
          `${rel} ${handler.name}() never calls databaseFailure`,
        );
      }
    });
  }
});

describe("the health check reports schema drift", () => {
  const source = readFileSync(
    join(ROOT, "app", "api", "health", "route.ts"),
    "utf8",
  );

  it("knows about the migration state, not just connectivity", () => {
    assert.ok(
      /schema_behind/.test(source),
      "a health check that only pings the database says 'ok' while every real route 500s",
    );
    assert.ok(
      /compareSchemaState/.test(source),
      "the health route should use the shared comparison, not its own",
    );
  });

  it("names no credential", () => {
    for (const leak of ["DATABASE_URL", "connectionString", "password"]) {
      assert.ok(!source.includes(leak), `health route mentions ${leak}`);
    }
  });
});
