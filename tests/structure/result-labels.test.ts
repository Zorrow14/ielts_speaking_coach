/**
 * Two contracts the Stage 2 redesign must not break.
 *
 * 1. THE ESTIMATE LABELS. "Label all scores as estimates; never present
 *    Pronunciation as a real band" is a hard rule in CLAUDE.md. A redesign is
 *    exactly when a label quietly disappears into a tidier layout, so this
 *    reads ResultCard and asserts every score still carries it, and that
 *    Pronunciation is still drawn as an indicator rather than a band.
 *
 * 2. THE LEVEL METER'S SAFETY. The recorder is the one thing in the app that
 *    must not break, and the meter is new code bolted beside it. On iOS
 *    Safari an AudioContext only runs if it was started inside the user's
 *    tap, and the meter must never be able to delay or block a recording.
 *    These are ordering rules, which a source check can pin and a unit test
 *    in Node (no MediaRecorder, no AudioContext) cannot.
 *
 * Source-reading rather than rendering because ResultCard's "@/" imports are
 * not rewritten in the compiled test build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/** Comments out, so prose describing a rule cannot satisfy it. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** The body of a top-level function, by name. */
function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\s*\\(`));
  assert.notEqual(start, -1, `function ${name} not found`);
  const next = source.slice(start + 1).search(/\n(?:export\s+)?(?:default\s+)?function\s+\w+\s*\(/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("every score on the results screen is labelled an estimate", () => {
  const source = read("components", "ResultCard.tsx");
  const code = codeOnly(source);

  it("defines the label once, word for word", () => {
    assert.match(code, /const ESTIMATE = "AI estimate, not an official IELTS band";/);
  });

  it("puts it under the overall band", () => {
    const main = functionBody(code, "ResultCard");
    const hero = main.slice(main.indexOf("score-hero__band"));
    assert.ok(main.includes("score-hero__band"), "the overall band is missing");
    assert.match(
      hero.slice(0, 400),
      /\{ESTIMATE\}/,
      "the overall band is not followed by the estimate label",
    );
  });

  it("puts it on every criterion band", () => {
    assert.match(functionBody(code, "Criterion"), /\{ESTIMATE\}/);
  });

  it("puts it on the pronunciation indicator too", () => {
    assert.match(functionBody(code, "Pronunciation"), /\{ESTIMATE\}/);
  });

  it("keeps the closing line that covers the whole card", () => {
    assert.match(code, /All scores are\s+AI estimates, not official IELTS bands\./);
  });
});

describe("pronunciation is an indicator, never a band", () => {
  const code = codeOnly(read("components", "ResultCard.tsx"));
  const pronunciation = functionBody(code, "Pronunciation");

  it("is rendered by its own component, separately from the three bands", () => {
    assert.match(code, /c\.key !== "pronunciation"/);
    assert.match(code, /<Pronunciation\b/);
  });

  it("says so in words", () => {
    assert.match(pronunciation, /Indicator only, not a band/);
  });

  it("shows its confidence", () => {
    assert.match(pronunciation, /Confidence: \{confidence\}/);
    assert.match(pronunciation, /confidenceLabel\(confidence\)/);
  });

  it("has no band bar, so it cannot be read as a fourth band", () => {
    assert.doesNotMatch(
      pronunciation,
      /band-bar/,
      "a band bar on pronunciation presents it as a real band",
    );
  });

  it("is left out of the retry comparison table", () => {
    const compare = codeOnly(read("components", "RetryComparison.tsx"));
    const criteria = compare.slice(compare.indexOf("const CRITERIA"), compare.indexOf("] as const"));
    assert.doesNotMatch(criteria, /pronunciation/);
    assert.match(compare, /Both are AI estimates, so the difference is an estimate too\./);
  });
});

describe("the level meter cannot get in the way of a recording", () => {
  const recorder = codeOnly(read("components", "Recorder.tsx"));
  const meter = codeOnly(read("lib", "use-level-meter.ts"));
  const start = recorder.slice(recorder.indexOf("const start = useCallback"));

  it("prepares its AudioContext inside the tap, before the first await", () => {
    // iOS Safari only runs an AudioContext started inside a user gesture,
    // and the gesture ends at the first await.
    const prepare = start.indexOf("prepareMeter()");
    const firstAwait = start.search(/\bawait\b/);
    assert.notEqual(prepare, -1, "start() never prepares the meter");
    assert.ok(
      prepare < firstAwait,
      "prepareMeter() runs after an await, outside the user gesture, so iOS keeps the context suspended",
    );
  });

  it("attaches only after MediaRecorder has started", () => {
    const recorderStart = start.indexOf("recorder.start()");
    const attach = start.indexOf("attachMeter(stream)");
    assert.notEqual(attach, -1, "the meter is never attached");
    assert.ok(
      recorderStart !== -1 && recorderStart < attach,
      "the meter attaches before recording starts, so a meter failure could block the recording",
    );
  });

  it("is torn down whenever the recorder cleans up", () => {
    const cleanUp = recorder.slice(recorder.indexOf("const cleanUp = useCallback"));
    assert.match(cleanUp.slice(0, 200), /detachMeter\(\)/);
  });

  it("never plays anything: the analyser is not connected to the speakers", () => {
    assert.doesNotMatch(meter, /\.destination\b/);
    assert.match(meter, /source\.connect\(analyser\)/);
  });

  it("keeps no audio: no recording, buffering or network calls", () => {
    for (const forbidden of [/MediaRecorder/, /\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /\.push\(/]) {
      assert.doesNotMatch(meter, forbidden, `use-level-meter.ts matches ${forbidden}`);
    }
  });

  it("swallows its own failures rather than throwing into the recorder", () => {
    // prepare, attach and detach each wrap their Web Audio calls.
    const tries = [...meter.matchAll(/\btry\s*\{/g)].length;
    assert.ok(tries >= 3, `expected prepare, attach and detach to be guarded; found ${tries} try blocks`);
  });
});
