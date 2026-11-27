"use client";

/**
 * Guest practice. The whole flow for someone with no account.
 *
 * The privacy promise is enforced by what this component does NOT have:
 *
 *   - no localStorage, no sessionStorage, no IndexedDB, no cookie it sets
 *     itself. The only state is React state, which dies with the tab.
 *   - no history, no progress, no notebook. Those pages read the database,
 *     and a guest has nothing in it.
 *   - the download is built from the results already in memory and handed to
 *     the browser as a Blob. Nothing is uploaded to produce it.
 *
 * `usedTopics` is kept here and sent with each question request, because the
 * owner's "don't repeat topics" feature reads history from the database and a
 * guest has none. Keeping it client-side is what makes that possible without
 * storing anything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Recorder, { type Recording } from "./Recorder";
import ResultCard from "./ResultCard";
import { PART2_SOFT_LIMIT_MS, formatClock } from "@/lib/audio";
import type { ResultView } from "@/lib/result-view";
import type { Part, QuestionResponse } from "@/lib/schemas";

const REQUEST_TIMEOUT_MS = 90_000;

type Stage =
  | "consent"
  | "starting"
  | "choosing"
  | "loading"
  | "ready"
  | "uploading"
  | "evaluating"
  | "failed"
  | "result"
  | "blocked";

type GuestResult = {
  part: Part;
  question: string;
  transcript: string;
  durationSec: number | null;
  wordCount: number | null;
  view: ResultView | null;
  at: Date;
};

type Pending = { recording: Recording; attempts: number };

type Limits = {
  evaluations: number;
  questions: number;
  maxSecondsPart13: number;
  maxSecondsPart2: number;
};

export default function GuestSession() {
  const [stage, setStage] = useState<Stage>("consent");
  const [consented, setConsented] = useState(false);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [part, setPart] = useState<Part>(1);
  const [question, setQuestion] = useState<QuestionResponse | null>(null);
  const [results, setResults] = useState<GuestResult[]>([]);
  const [latest, setLatest] = useState<GuestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  /** Topics already used this visit. Memory only - this is the whole point. */
  const usedTopicsRef = useRef<string[]>([]);
  const inFlightRef = useRef(false);

  /** Warn before a refresh throws the results away. */
  useEffect(() => {
    if (results.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [results.length]);

  const start = useCallback(async () => {
    setStage("starting");
    setError(null);
    try {
      const response = await fetch("/api/guest/start", {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Guest mode is not available right now.");
        setStage("blocked");
        return;
      }
      setLimits(data.limits as Limits);
      setStage("choosing");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setStage("blocked");
    }
  }, []);

  const loadQuestion = useCallback(
    async (chosen: Part) => {
      setStage("loading");
      setError(null);
      setLatest(null);
      try {
        const response = await fetch("/api/guest/question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            part: chosen,
            avoidTopics: usedTopicsRef.current,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "Could not load a question.");
          setStage(response.status === 429 ? "blocked" : "choosing");
          return;
        }
        const next = data as QuestionResponse;
        if (next.topic) usedTopicsRef.current = [...usedTopicsRef.current, next.topic];
        setQuestion(next);
        setStage("ready");
      } catch {
        setError("Could not reach the server. Check your connection.");
        setStage("choosing");
      }
    },
    [],
  );

  const send = useCallback(
    async (job: Pending) => {
      if (!question) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      setPending({ ...job, attempts: job.attempts + 1 });
      setStage("uploading");
      setError(null);

      const form = new FormData();
      form.append("audio", job.recording.blob, "answer");
      form.append("question", questionText(question));
      form.append("part", String(question.part));
      form.append("durationSec", String(job.recording.durationSec));

      try {
        const response = await fetch("/api/guest/evaluate", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        setStage("evaluating");
        const data = await response.json();

        if (!response.ok) {
          setError(data.error ?? "Marking failed.");
          // A limit refusal is final; anything else is worth retrying.
          setStage(response.status === 429 ? "blocked" : "failed");
          return;
        }

        const result: GuestResult = {
          part: question.part,
          question: questionText(question),
          transcript: (data.transcript ?? "") as string,
          durationSec: data.durationSec ?? job.recording.durationSec,
          wordCount: data.wordCount ?? null,
          view: (data.view ?? null) as ResultView | null,
          at: new Date(),
        };

        if (typeof data.remaining === "number") setRemaining(data.remaining);
        setPending(null);
        setLatest(result);
        setResults((previous) => [...previous, result]);
        setStage("result");
      } catch (cause) {
        const timedOut =
          cause instanceof Error &&
          (cause.name === "TimeoutError" || cause.name === "AbortError");
        setError(
          timedOut
            ? "That took too long and was stopped. Your recording is still here - press Try again."
            : "The upload failed. Check your connection, then press Try again.",
        );
        setStage("failed");
      } finally {
        inFlightRef.current = false;
      }
    },
    [question],
  );

  const submit = useCallback(
    (recording: Recording) => void send({ recording, attempts: 0 }),
    [send],
  );

  const retry = useCallback(() => {
    if (pending) void send(pending);
  }, [pending, send]);

  /** Builds the download in the browser. No request, nothing uploaded. */
  const download = useCallback(() => {
    const blob = new Blob([toMarkdown(results)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ielts-guest-feedback-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const hardLimitMs =
    (question?.part === 2
      ? (limits?.maxSecondsPart2 ?? 120)
      : (limits?.maxSecondsPart13 ?? 90)) * 1000;

  return (
    <>
      <p className="alert alert--banner" role="status">
        <strong>Guest mode:</strong> your results are not saved and disappear
        when you refresh or close this page. Download them before you leave if
        you want to keep them.
      </p>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {stage === "consent" ? (
        <section className="card">
          <h2>Before you start</h2>
          <p>
            This app records your answer and sends the audio to Google&apos;s
            Gemini API, which produces the transcript and the feedback. This app
            does not store your audio, your transcript or your feedback
            anywhere.
          </p>
          <p className="muted">
            Read the <Link href="/privacy">privacy page</Link> and the{" "}
            <Link href="/terms">terms</Link> for exactly what happens, including
            what Google may do with it.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span>
              I understand my audio is processed by Google&apos;s Gemini API.
            </span>
          </label>
          <button
            type="button"
            className="button"
            onClick={start}
            disabled={!consented}
          >
            Continue
          </button>
        </section>
      ) : null}

      {stage === "starting" ? (
        <section className="card">
          <p role="status">Checking your browser&hellip;</p>
        </section>
      ) : null}

      {stage === "choosing" && limits ? (
        <section className="card">
          <h2>Pick a part</h2>
          <p className="muted">
            Guest mode marks {limits.evaluations} answers. Parts 1 and 3 allow{" "}
            {limits.maxSecondsPart13} seconds; Part 2 allows{" "}
            {limits.maxSecondsPart2}.
          </p>
          <div className="row">
            {([1, 2, 3] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`button${part === value ? "" : " button--quiet"}`}
                onClick={() => {
                  setPart(value);
                  void loadQuestion(value);
                }}
              >
                Part {value}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {stage === "loading" ? (
        <section className="card">
          <p role="status">Preparing your question&hellip;</p>
        </section>
      ) : null}

      {question && (stage === "ready" || stage === "failed") ? (
        <QuestionPanel question={question} />
      ) : null}

      {stage === "ready" && question ? (
        <section className="card">
          <Recorder
            onComplete={submit}
            hardLimitMs={hardLimitMs}
            softLimitMs={question.part === 2 ? PART2_SOFT_LIMIT_MS : undefined}
            label="Start recording"
          />
          <p className="muted">
            Recording stops automatically at {formatClock(hardLimitMs)}. Your
            audio is sent for marking and is never saved by this app.
          </p>
        </section>
      ) : null}

      {stage === "uploading" || stage === "evaluating" ? (
        <section className="card">
          <p role="status" aria-live="polite">
            {stage === "uploading"
              ? "Uploading your recording..."
              : "Marking your answer. This usually takes a few seconds."}
          </p>
        </section>
      ) : null}

      {stage === "failed" && pending ? (
        <section className="card">
          <h3>That did not go through</h3>
          <p>
            Your recording is still here, in memory only. Retrying sends the
            same audio.
          </p>
          <div className="row">
            <button type="button" className="button" onClick={retry}>
              Try again
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setPending(null);
                setError(null);
                setStage("ready");
              }}
            >
              Discard and re-record
            </button>
          </div>
        </section>
      ) : null}

      {stage === "result" && latest ? (
        <>
          <ResultCard
            question={latest.question}
            transcript={latest.transcript}
            durationSec={latest.durationSec}
            wordCount={latest.wordCount}
            view={latest.view}
          />
          <section className="card">
            <p className="muted">
              {remaining !== null && remaining > 0
                ? `${remaining} more ${remaining === 1 ? "answer" : "answers"} available in this guest session.`
                : "That was your last guest answer."}
            </p>
            <div className="row">
              {remaining !== null && remaining > 0 ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setStage("choosing")}
                >
                  Another question
                </button>
              ) : null}
              <button
                type="button"
                className="button button--quiet"
                onClick={download}
              >
                Download my feedback
              </button>
            </div>
          </section>
        </>
      ) : null}

      {stage === "blocked" ? (
        <section className="card">
          <h2>That is as far as guest mode goes</h2>
          <p className="muted">
            {results.length > 0
              ? "Download your feedback before you leave - it is not saved anywhere."
              : "Nothing has been saved, and nothing is wrong."}
          </p>
          <div className="row">
            {results.length > 0 ? (
              <button type="button" className="button" onClick={download}>
                Download my feedback
              </button>
            ) : null}
            <Link className="button button--quiet" href="/login">
              Sign in as the owner
            </Link>
          </div>
        </section>
      ) : null}

      {results.length > 0 && stage !== "blocked" && stage !== "result" ? (
        <section className="card">
          <p className="muted">
            {results.length} {results.length === 1 ? "answer" : "answers"}{" "}
            marked this visit, held in memory only.
          </p>
          <button type="button" className="button button--quiet" onClick={download}>
            Download my feedback
          </button>
        </section>
      ) : null}
    </>
  );
}

function QuestionPanel({ question }: { question: QuestionResponse }) {
  if (question.part === 2) {
    return (
      <section className="card cue-card">
        <p className="muted">Part 2 cue card &middot; {question.topic}</p>
        <h2>{question.prompt}</h2>
        <p>You should say:</p>
        <ul className="bullets">
          {question.bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="muted">
        Part {question.part} &middot; {question.topic}
      </p>
      <h2>{question.question}</h2>
    </section>
  );
}

function questionText(question: QuestionResponse): string {
  if (question.part === 2) {
    return [
      question.prompt,
      "You should say:",
      ...question.bullets.map((bullet) => `- ${bullet}`),
    ].join("\n");
  }
  return question.question;
}

/** The downloadable report, assembled from what is already in memory. */
function toMarkdown(results: GuestResult[]): string {
  const lines: string[] = [
    "# IELTS Speaking practice feedback",
    "",
    "Produced in guest mode. **All scores are AI estimates, not official IELTS bands.**",
    "This app is not affiliated with or endorsed by IELTS or its owners.",
    "",
    `Downloaded ${new Date().toLocaleString()}.`,
    "",
  ];

  results.forEach((result, index) => {
    lines.push(`---`, "", `## Answer ${index + 1} — Part ${result.part}`, "");
    lines.push(`**Question**`, "", result.question, "");
    lines.push(
      `**Your answer** (${result.wordCount ?? 0} words${result.durationSec ? `, ${result.durationSec} seconds` : ""})`,
      "",
      result.transcript || "(no speech detected)",
      "",
    );

    const view = result.view;
    if (!view) {
      lines.push("_This answer has no saved marking._", "");
      return;
    }

    lines.push(`**Overall estimate: ${view.overall}** (AI estimate, not an official IELTS band)`, "");

    for (const note of view.guardrails) {
      lines.push(`> ${note.message}`, "");
    }

    lines.push("### Criteria", "");
    for (const criterion of view.criteria) {
      lines.push(`**${criterion.label}: ${criterion.band ?? "n/a"}**`);
      if (criterion.key === "pronunciation") {
        lines.push("", "_Indicator only, not a band — the least reliable of the four._");
      }
      lines.push("");
      for (const quote of criterion.evidence) {
        lines.push(`- "${quote}"`);
      }
      for (const detail of criterion.details) {
        lines.push(`- ${detail}`);
      }
      lines.push("");
    }

    if (view.mistakes.length > 0) {
      lines.push("### Mistakes and corrections", "");
      for (const mistake of view.mistakes) {
        lines.push(
          `- **${mistake.category}**: "${mistake.original}" → "${mistake.correction}"${
            mistake.explanation ? ` — ${mistake.explanation}` : ""
          }`,
        );
      }
      lines.push("");
    }

    if (view.fillerNotes.length > 0 || view.repetitionNotes.length > 0) {
      lines.push("### Fillers and repetition", "");
      for (const note of [...view.fillerNotes, ...view.repetitionNotes]) {
        lines.push(`- ${note}`);
      }
      lines.push("");
    }

    if (view.strengths.length > 0) {
      lines.push("### What worked", "");
      for (const item of view.strengths) lines.push(`- ${item}`);
      lines.push("");
    }

    if (view.nextSteps.length > 0) {
      lines.push("### Next steps, highest impact first", "");
      view.nextSteps.forEach((item, position) =>
        lines.push(`${position + 1}. ${item}`),
      );
      lines.push("");
    }

    lines.push(`_Marked by ${view.model}, prompt ${view.promptVersion}._`, "");
  });

  return lines.join("\n");
}
