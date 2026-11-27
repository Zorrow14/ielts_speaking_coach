/**
 * Retries must not reach the trend.
 *
 * A second go at a question you have already been marked on is not a cold
 * answer - you have read the corrections. Letting retries into the moving
 * average or the baseline would make the trend measure recall as much as
 * improvement, and it would do it silently.
 *
 * This reads the SQL in lib/db/progress.ts and asserts the exclusion is
 * present in every score aggregate, with `retrySeries` as the one documented
 * exception. A behavioural test would only cover the queries it happened to
 * call; a new aggregate added next month is exactly the case that matters.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SOURCE = readFileSync(
  join(process.cwd(), "lib", "db", "progress.ts"),
  "utf8",
);

/** Strips comments so prose about retries cannot satisfy a check. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

const CODE = codeOnly(SOURCE);

/**
 * The body of each query, by name.
 *
 * Splits on EVERY function declaration, not only the exported ones. The
 * private `periodAverages` sits between two exports, so slicing on exports
 * alone would staple its body onto the previous function and make that
 * function look like it used the fragment twice.
 */
function exportedQueries(code: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  const starts: Array<{ name: string; at: number }> = [];
  for (const match of code.matchAll(pattern)) {
    starts.push({ name: match[1], at: match.index });
  }
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : code.length;
    found.set(start.name, code.slice(start.at, end));
  });
  return found;
}

const QUERIES = exportedQueries(CODE);

/**
 * Aggregates that describe how the learner is doing over time. Every one of
 * these must exclude retries.
 */
const SCORE_AGGREGATES = [
  "scoreSeries",
  "baseline",
  "weekComparison",
  "promptWindows",
];

/** Reads retries on purpose, and is the only thing allowed to. */
const RETRY_SERIES = "retrySeries";

describe("the exclusion exists and is shared", () => {
  it("is defined once, as a named fragment", () => {
    assert.match(
      CODE,
      /const EXCLUDE_RETRIES = sql`and a\.retry_of_answer_id is null`/,
      "expected a single shared EXCLUDE_RETRIES fragment",
    );
    const definitions = [...CODE.matchAll(/const EXCLUDE_RETRIES\b/g)].length;
    assert.equal(definitions, 1, "EXCLUDE_RETRIES should be defined once");
  });

  it("is not duplicated inside one query", () => {
    // An earlier patch applied it twice in baseline(); harmless in SQL but a
    // sign the edit was mechanical rather than read.
    for (const [name, body] of QUERIES) {
      const uses = [...body.matchAll(/\$\{EXCLUDE_RETRIES\}/g)].length;
      assert.ok(uses <= 1, `${name}() applies EXCLUDE_RETRIES ${uses} times`);
    }
  });
});

describe("every score aggregate excludes retries", () => {
  for (const name of SCORE_AGGREGATES) {
    it(`${name}() excludes them`, () => {
      const body = QUERIES.get(name);
      assert.ok(body, `${name}() not found in progress.ts`);
      assert.match(
        body,
        /\$\{EXCLUDE_RETRIES\}/,
        `${name}() does not exclude retries, so a second attempt would inflate it`,
      );
    });
  }

  it("periodAverages, which backs the daily and weekly lines, excludes them", () => {
    const body = QUERIES.get("periodAverages") ?? CODE;
    // periodAverages is module-private, so fall back to the whole file and
    // assert on the one query that mentions date_trunc buckets.
    assert.match(body, /\$\{EXCLUDE_RETRIES\}/);
  });

  it("the list of aggregates here has not fallen behind the module", () => {
    // If someone adds a new aggregate over feedback, this test should be
    // updated deliberately rather than silently passing.
    const aggregatesOverFeedback = [...QUERIES.entries()].filter(
      ([name, body]) =>
        /from feedback f/.test(body) && name !== RETRY_SERIES,
    );
    for (const [name, body] of aggregatesOverFeedback) {
      assert.match(
        body,
        /\$\{EXCLUDE_RETRIES\}/,
        `${name}() reads feedback but does not exclude retries. If that is ` +
          `deliberate, add it to the documented exceptions in this test.`,
      );
    }
  });
});

describe("retrySeries is the documented exception", () => {
  const body = QUERIES.get(RETRY_SERIES);

  it("exists", () => {
    assert.ok(body, "retrySeries() should exist so retries are still visible");
  });

  it("selects only retries, rather than excluding them", () => {
    assert.match(body!, /a\.retry_of_answer_id is not null/);
    assert.doesNotMatch(
      body!,
      /\$\{EXCLUDE_RETRIES\}/,
      "retrySeries is meant to return retries",
    );
  });

  it("joins the original attempt so the pair can be shown together", () => {
    assert.match(body!, /join answers\s+oa on oa\.id = a\.retry_of_answer_id/);
    assert.match(body!, /join feedback of on of\.answer_id = oa\.id/);
  });

  it("scopes every joined table by user_id", () => {
    // Four joins plus the where clause; a missing filter on the self-join is
    // the easy way to leak another user's earlier attempt.
    const scoped = [...body!.matchAll(/user_id = \$\{userId\}/g)].length;
    assert.ok(
      scoped >= 5,
      `retrySeries filters by user_id only ${scoped} times; expected one per join plus the where`,
    );
  });
});

describe("the retry link itself", () => {
  const schema = readFileSync(
    join(process.cwd(), "lib", "db", "schema.ts"),
    "utf8",
  );

  it("is a nullable self-reference that survives deleting the original", () => {
    assert.match(schema, /retryOfAnswerId: uuid\("retry_of_answer_id"\)/);
    assert.match(schema, /onDelete\("set null"\)/);
  });

  it("is indexed only where it is set", () => {
    assert.match(schema, /index\("answers_retry_of_idx"\)/);
    assert.match(schema, /retryOfAnswerId\} is not null/);
  });
});
