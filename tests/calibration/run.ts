/**
 * Calibration harness. A script, not part of the app.
 *
 * It runs every fixture transcript through the real evaluation prompt three
 * times and reports:
 *
 *   - each criterion band per run
 *   - the spread between runs (max minus min) per criterion
 *   - whether the ORDER of the intended bands is preserved
 *   - any fixture scoring more than 0.5 above the band it was aimed at
 *
 * What this does NOT do: prove the scores are accurate. There is no official
 * marking of these fixtures to compare against, and the intended bands are my
 * own judgement. The harness measures consistency between runs and relative
 * ordering, which is what can honestly be checked without a real examiner.
 *
 * Pronunciation is absent by design: the fixtures are text, so the prompt is
 * told there is no audio and returns a null band with "unavailable"
 * confidence. The harness checks that it does exactly that rather than
 * inventing a pronunciation score from spelling.
 *
 * Run with: npm run calibrate
 */
import { evaluateTranscript } from "../../lib/gemini";
import { PROMPT_VERSION } from "../../lib/prompts/evaluate";
import { roundToHalfBand, score } from "../../lib/scoring";
import { FIXTURES, type Fixture } from "./fixtures";

const RUNS_PER_FIXTURE = 3;

/** Gap between calls, to stay inside the free-tier requests-per-minute limit. */
const DELAY_MS = 4_000;

/** How far above the intended band counts as inflation worth flagging. */
const INFLATION_THRESHOLD = 0.5;

type CriterionKey = "fluency" | "lexical" | "grammar";
const CRITERIA: CriterionKey[] = ["fluency", "lexical", "grammar"];

type RunResult = {
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  overall: number | null;
  pronunciationBand: number | null;
  pronunciationConfidence: string;
  evidenceCounts: Record<string, number>;
  sentencesWithErrors: number;
  sentencesTotal: number;
  errorTypes: string[];
  nextSteps: number;
  error?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFixture(fixture: Fixture, seed: number): Promise<RunResult> {
  try {
    const { evaluation } = await evaluateTranscript({
      part: fixture.part,
      question: fixture.question,
      transcript: fixture.transcript,
      durationSec: fixture.durationSec,
      seed,
    });

    const scored = score({
      evaluation,
      part: fixture.part,
      durationSec: fixture.durationSec,
    });

    return {
      fluency: scored?.bands.fluency ?? null,
      lexical: scored?.bands.lexical ?? null,
      grammar: scored?.bands.grammar ?? null,
      overall: scored?.overall ?? null,
      pronunciationBand: evaluation.pronunciation.band,
      pronunciationConfidence: evaluation.pronunciation.confidence,
      evidenceCounts: {
        fluency: evaluation.fluency.evidence.length,
        lexical: evaluation.lexical.evidence.length,
        grammar: evaluation.grammar.evidence.length,
      },
      sentencesWithErrors: evaluation.grammar.sentences_with_errors,
      sentencesTotal: evaluation.grammar.sentences_total,
      errorTypes: evaluation.grammar.error_types,
      nextSteps: evaluation.next_steps.length,
    };
  } catch (error) {
    return {
      fluency: null,
      lexical: null,
      grammar: null,
      overall: null,
      pronunciationBand: null,
      pronunciationConfidence: "error",
      evidenceCounts: {},
      sentencesWithErrors: 0,
      sentencesTotal: 0,
      errorTypes: [],
      nextSteps: 0,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

function numbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function spread(values: Array<number | null>): number | null {
  const present = numbers(values);
  if (present.length < 2) return null;
  return Math.max(...present) - Math.min(...present);
}

function mean(values: Array<number | null>): number | null {
  const present = numbers(values);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function fmt(value: number | null, digits = 1): string {
  return value === null ? " -- " : value.toFixed(digits).padStart(4);
}

async function main() {
  process.loadEnvFile(".env.local");

  console.log("IELTS Speaking Coach - calibration run");
  console.log(`prompt version : ${PROMPT_VERSION}`);
  console.log(`model          : ${process.env.GEMINI_MODEL}`);
  console.log(`fixtures       : ${FIXTURES.length}`);
  console.log(`runs each      : ${RUNS_PER_FIXTURE}`);
  console.log(`started        : ${new Date().toISOString()}`);
  console.log("");
  console.log(
    "Intended bands are hand-assigned, not official. This checks consistency",
  );
  console.log("between runs and relative ordering, not absolute accuracy.");
  console.log("");

  const summaries: Array<{
    fixture: Fixture;
    runs: RunResult[];
    meanOverall: number | null;
  }> = [];

  for (const fixture of FIXTURES) {
    const runs: RunResult[] = [];
    for (let run = 0; run < RUNS_PER_FIXTURE; run += 1) {
      // A different seed per run, so the three results are independent
      // samples rather than three copies of the same cached answer.
      runs.push(await runFixture(fixture, 1_000 + run));
      await sleep(DELAY_MS);
    }
    const meanOverall = mean(runs.map((r) => r.overall));
    summaries.push({ fixture, runs, meanOverall });

    console.log(`--- ${fixture.id}  (Part ${fixture.part}, intended ${fixture.intended.toFixed(1)})`);
    console.log(`    ${fixture.note}`);
    console.log("    run |  F    L    G   | ovr | ev(F/L/G) | err sent | types");
    runs.forEach((result, index) => {
      if (result.error) {
        console.log(`      ${index + 1} | FAILED: ${result.error}`);
        return;
      }
      const ev = `${result.evidenceCounts.fluency}/${result.evidenceCounts.lexical}/${result.evidenceCounts.grammar}`;
      console.log(
        `      ${index + 1} | ${fmt(result.fluency)} ${fmt(result.lexical)} ${fmt(result.grammar)} |${fmt(result.overall)} | ${ev.padEnd(9)} | ${String(`${result.sentencesWithErrors}/${result.sentencesTotal}`).padEnd(8)} | ${result.errorTypes.join(",")}`,
      );
    });

    const spreads = CRITERIA.map(
      (key) => `${key[0].toUpperCase()}=${spread(runs.map((r) => r[key])) ?? "n/a"}`,
    ).join("  ");
    console.log(
      `    spread: ${spreads}  overall=${spread(runs.map((r) => r.overall)) ?? "n/a"}  mean overall=${fmt(meanOverall, 2).trim()}`,
    );

    const badPronunciation = runs.filter(
      (r) => !r.error && (r.pronunciationBand !== null || r.pronunciationConfidence !== "unavailable"),
    ).length;
    if (badPronunciation > 0) {
      console.log(
        `    WARNING: ${badPronunciation} run(s) returned a pronunciation judgement with no audio.`,
      );
    }
    const missingEvidence = runs.filter(
      (r) =>
        !r.error &&
        CRITERIA.some((key) => (r.evidenceCounts[key] ?? 0) === 0),
    ).length;
    if (missingEvidence > 0) {
      console.log(`    WARNING: ${missingEvidence} run(s) scored a criterion with no evidence.`);
    }
    const wrongNextSteps = runs.filter((r) => !r.error && r.nextSteps !== 3).length;
    if (wrongNextSteps > 0) {
      console.log(`    WARNING: ${wrongNextSteps} run(s) did not return exactly 3 next steps.`);
    }
    console.log("");
  }

  // --- Report ------------------------------------------------------------

  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log("");
  console.log("fixture                      part  intended  mean overall  delta  max spread");
  for (const { fixture, runs, meanOverall } of summaries) {
    const delta = meanOverall === null ? null : meanOverall - fixture.intended;
    const maxSpread = Math.max(
      ...CRITERIA.map((key) => spread(runs.map((r) => r[key])) ?? 0),
      spread(runs.map((r) => r.overall)) ?? 0,
    );
    console.log(
      `${fixture.id.padEnd(28)} ${fixture.part}     ${fixture.intended.toFixed(1)}       ${fmt(meanOverall, 2)}      ${delta === null ? " -- " : (delta >= 0 ? "+" : "") + delta.toFixed(2)}   ${maxSpread.toFixed(1)}`,
    );
  }
  console.log("");

  // Inflation check.
  const inflated = summaries.filter(
    ({ fixture, meanOverall }) =>
      meanOverall !== null && meanOverall - fixture.intended > INFLATION_THRESHOLD,
  );
  console.log(`INFLATION (mean overall more than ${INFLATION_THRESHOLD} above intended)`);
  if (inflated.length === 0) {
    console.log("  none");
  } else {
    for (const { fixture, meanOverall } of inflated) {
      console.log(
        `  ${fixture.id}: intended ${fixture.intended.toFixed(1)}, scored ${meanOverall!.toFixed(2)} (+${(meanOverall! - fixture.intended).toFixed(2)})`,
      );
    }
  }
  console.log("");

  // Ordering check: group by intended band and compare group means.
  const byIntended = new Map<number, number[]>();
  for (const { fixture, meanOverall } of summaries) {
    if (meanOverall === null) continue;
    const list = byIntended.get(fixture.intended) ?? [];
    list.push(meanOverall);
    byIntended.set(fixture.intended, list);
  }
  const levels = [...byIntended.entries()]
    .map(([intended, means]) => ({
      intended,
      mean: means.reduce((a, b) => a + b, 0) / means.length,
      count: means.length,
    }))
    .sort((a, b) => a.intended - b.intended);

  console.log("ORDERING (mean overall per intended band)");
  for (const level of levels) {
    console.log(
      `  intended ${level.intended.toFixed(1)} (${level.count} fixtures): ${level.mean.toFixed(2)}`,
    );
  }
  let ordered = true;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i].mean <= levels[i - 1].mean) {
      ordered = false;
      console.log(
        `  BROKEN: intended ${levels[i].intended.toFixed(1)} scored ${levels[i].mean.toFixed(2)}, not above intended ${levels[i - 1].intended.toFixed(1)} at ${levels[i - 1].mean.toFixed(2)}`,
      );
    }
  }
  console.log(`  order preserved: ${ordered ? "YES" : "NO"}`);
  console.log("");

  const failures = summaries.flatMap(({ runs }) => runs.filter((r) => r.error));
  console.log(`failed calls: ${failures.length}`);
  console.log(`finished    : ${new Date().toISOString()}`);

  // A broken ordering or an inflated fixture is a real finding, so make the
  // exit code reflect it - this is the signal worth watching over time.
  if (!ordered || inflated.length > 0) process.exitCode = 1;
}

/** Sanity check on the rounding rule, which is pure arithmetic. */
function checkRounding() {
  const cases: Array<[number[], number]> = [
    [[5, 6, 6, 7], 6],
    [[6, 6, 6, 7], 6.5],
    [[6, 7, 7, 7], 7],
    [[5, 6, 6, 6], 6],
    [[5, 5, 5, 5], 5],
    [[6.5, 7, 7, 7.5], 7],
    [[5, 5, 6, 6], 5.5],
  ];
  for (const [bands, expected] of cases) {
    const actual = roundToHalfBand(bands);
    if (actual !== expected) {
      throw new Error(
        `roundToHalfBand([${bands.join(", ")}]) = ${actual}, expected ${expected}`,
      );
    }
  }
  console.log(`rounding rule: ${cases.length} cases pass`);
}

checkRounding();
void main();
