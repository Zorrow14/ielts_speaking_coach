"use client";

/**
 * Drives one practice attempt for a single part.
 *
 * All state is in React memory and the database. Nothing is kept in
 * localStorage or sessionStorage, so a refresh abandons the attempt - the
 * answers already marked are safe in Neon and show up in history.
 *
 * Retry without re-recording: a failed upload or evaluation keeps the Blob in
 * component state so "Try again" re-sends the same audio. That is memory only
 * - never a file, never storage - and it dies with the page, which is exactly
 * the lifetime the plan's "audio is never persisted" rule wants.
 *
 * Each recording also carries a `clientToken`, one UUID generated when the
 * recording finishes and reused across retries. /api/evaluate treats it as an
 * idempotency key, so a double tap, or a retry after a timeout where the
 * server actually succeeded, returns the first result instead of marking and
 * charging twice.
 *
 * No model answer is ever generated or shown; the only feedback appears after
 * the user has recorded and submitted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import PrepRing from "./PrepRing";
import Recorder, { type Recording } from "./Recorder";
import ResultCard from "./ResultCard";
import RetryComparison from "./RetryComparison";
import { PART2_PREP_MS, PART2_SOFT_LIMIT_MS } from "@/lib/audio";
import type { ResultView } from "@/lib/result-view";
import type { Part, QuestionResponse } from "@/lib/schemas";

/** How many questions make up a session, per part. */
const QUESTIONS_PER_SESSION: Record<Part, number> = { 1: 4, 2: 1, 3: 4 };

/** Give up on one request after this long and offer a retry. */
const REQUEST_TIMEOUT_MS = 90_000;

type Stage =
  | "loading"
  | "prep"
  | "ready"
  | "uploading"
  | "evaluating"
  | "failed"
  | "result"
  | "finished";

type MarkedAnswer = {
  answerId: string;
  question: string;
  transcript: string;
  durationSec: number | null;
  wordCount: number | null;
  view: ResultView | null;
};

/** A recording waiting to be marked, or waiting for a retry. */
type Pending = {
  recording: Recording;
  /** Stable across retries: this is what makes the retry idempotent. */
  clientToken: string;
  attempts: number;
  /** Feature A: the earlier answer this recording is a second go at. */
  retryOf?: string | null;
};

export default function PracticeSession({ part }: { part: Part }) {
  const total = QUESTIONS_PER_SESSION[part];

  const [stage, setStage] = useState<Stage>("loading");
  const [question, setQuestion] = useState<QuestionResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answered, setAnswered] = useState<MarkedAnswer[]>([]);
  const [latest, setLatest] = useState<MarkedAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [prepMsLeft, setPrepMsLeft] = useState(PART2_PREP_MS);
  const [pending, setPending] = useState<Pending | null>(null);
  /**
   * Feature A. When set, the next recording for this question is a second go
   * at that answer. A retry does NOT advance the question counter and is not
   * appended to `answered` - it is another attempt at the same question, not
   * progress through the session.
   */
  const [retryOf, setRetryOf] = useState<string | null>(null);
  /** The answer id whose two attempts the comparison panel is showing. */
  const [comparisonFor, setComparisonFor] = useState<string | null>(null);
  /** Display only: whether the recorder is capturing right now. */
  const [recording, setRecording] = useState(false);

  // The transcript of the previous answer, which Part 3 follow-ups build on.
  const previousRef = useRef<{ question: string; transcript: string } | null>(
    null,
  );
  const requestedRef = useRef(false);
  /** Guards against a second submit while one is in flight. */
  const inFlightRef = useRef(false);

  const loadQuestion = useCallback(async () => {
    setStage("loading");
    setError(null);
    try {
      const response = await fetch("/api/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part,
          previousQuestion: previousRef.current?.question,
          previousTranscript: previousRef.current?.transcript,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not load a question.");
        setStage("ready");
        return;
      }
      if (data.usage) setUsage(data.usage);
      setQuestion(data as QuestionResponse);
      if (part === 2) {
        setPrepMsLeft(PART2_PREP_MS);
        setStage("prep");
      } else {
        setStage("ready");
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
      setStage("ready");
    }
  }, [part]);

  // First question. The ref guard keeps React's development double-invoke from
  // spending two Gemini requests.
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void loadQuestion();
  }, [loadQuestion]);

  // Part 2 preparation countdown. Derived from a start timestamp so a dimmed
  // screen or a throttled timer cannot stretch the minute.
  useEffect(() => {
    if (stage !== "prep") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = PART2_PREP_MS - (Date.now() - startedAt);
      if (left <= 0) {
        clearInterval(timer);
        setPrepMsLeft(0);
        setStage("ready");
      } else {
        setPrepMsLeft(left);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [stage]);

  const questionText = question ? toQuestionText(question) : "";

  /** Sends, or re-sends, one recording for marking. */
  const send = useCallback(
    async (job: Pending) => {
      if (!question) return;
      // A double tap cannot start a second upload. The server is idempotent
      // too, so this is the cheap guard rather than the only one.
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      setPending({ ...job, attempts: job.attempts + 1 });
      setStage("uploading");
      setError(null);

      const form = new FormData();
      // Sent as multipart, not base64 JSON: smaller and streamable.
      form.append("audio", job.recording.blob, "answer");
      form.append("question", questionText);
      form.append("part", String(part));
      form.append("durationSec", String(job.recording.durationSec));
      form.append("topic", question.topic);
      form.append("clientToken", job.clientToken);
      if (sessionId) form.append("sessionId", sessionId);
      if (job.retryOf) form.append("retryOfAnswerId", job.retryOf);

      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        // Headers are back, so the bytes are up; the wait from here is marking.
        setStage("evaluating");
        const data = await response.json();

        if (data.sessionId && !sessionId) setSessionId(data.sessionId);

        if (!response.ok) {
          setError(data.error ?? "Marking failed.");
          // The recording stays in `pending`, so Try again re-sends it.
          setStage("failed");
          return;
        }
        if (data.usage) setUsage(data.usage);

        const marked: MarkedAnswer = {
          answerId: data.answerId as string,
          question: questionText,
          transcript: (data.transcript ?? "") as string,
          durationSec: data.durationSec ?? job.recording.durationSec,
          wordCount: data.wordCount ?? null,
          view: (data.view ?? null) as ResultView | null,
        };

        previousRef.current = {
          question: questionText,
          transcript: marked.transcript,
        };
        setPending(null);
        setLatest(marked);
        // A retry replaces nothing and adds nothing: the counter tracks
        // questions answered, and this is the same question again.
        if (job.retryOf) {
          setComparisonFor(marked.answerId);
        } else {
          setAnswered((previous) => [...previous, marked]);
        }
        setRetryOf(null);
        setStage("result");
      } catch (cause) {
        const timedOut =
          cause instanceof Error &&
          (cause.name === "TimeoutError" || cause.name === "AbortError");
        setError(
          timedOut
            ? "That took too long and was stopped. Your recording is still here - press Try again."
            : "The upload failed. Check your connection, then press Try again - your recording is still here.",
        );
        setStage("failed");
      } finally {
        inFlightRef.current = false;
      }
    },
    [part, question, questionText, sessionId],
  );

  const submit = useCallback(
    (recording: Recording) => {
      void send({
        recording,
        // One token per recording, reused by every retry of it.
        clientToken: crypto.randomUUID(),
        attempts: 0,
        retryOf,
      });
    },
    [send, retryOf],
  );

  const retry = useCallback(() => {
    if (pending) void send(pending);
  }, [pending, send]);

  /** Give up on this recording and record a fresh one. */
  const discard = useCallback(() => {
    setPending(null);
    setError(null);
    setStage("ready");
  }, []);

  const answeredCount = answered.length;
  const isLastQuestion = answeredCount >= total;

  const next = useCallback(() => {
    if (isLastQuestion) {
      setStage("finished");
      return;
    }
    setLatest(null);
    setRetryOf(null);
    setComparisonFor(null);
    void loadQuestion();
  }, [isLastQuestion, loadQuestion]);

  /**
   * Record this same question again.
   *
   * The question text is kept exactly as it was - a different question would
   * make the comparison meaningless - and Part 2 gets its preparation minute
   * back, because that is part of what is being practised.
   */
  const tryAgain = useCallback(() => {
    if (!latest) return;
    setRetryOf(latest.answerId);
    setComparisonFor(null);
    setLatest(null);
    setError(null);
    setPending(null);
    if (part === 2) {
      setPrepMsLeft(PART2_PREP_MS);
      setStage("prep");
    } else {
      setStage("ready");
    }
  }, [latest, part]);

  const busy = stage === "uploading" || stage === "evaluating";
  const current = Math.min(answeredCount + 1, total);
  const status = stageStatus(stage, recording);

  return (
    <div className={`practice practice--${stage}`}>
      <header className="practice__header">
        <div className="practice__meta">
          <p className="eyebrow">
            Part {part}
            {total > 1 ? ` · Question ${current} of ${total}` : " · Long turn"}
          </p>
          {total > 1 ? (
            // The eyebrow already says "Question 2 of 4"; the dots are the
            // same fact drawn, so they are hidden from screen readers.
            <ol className="practice__steps" aria-hidden="true">
              {Array.from({ length: total }, (_, index) => (
                <li
                  key={index}
                  className={
                    index < answeredCount
                      ? "is-done"
                      : index === answeredCount && stage !== "finished"
                        ? "is-current"
                        : undefined
                  }
                />
              ))}
            </ol>
          ) : null}
        </div>

        {/* The one live region for the stage, so each change - Recording,
            Uploading, Marking, Marked - is announced once. */}
        <p className={`status status--${status.tone}`} role="status" aria-live="polite">
          <span className="status__dot" aria-hidden="true" />
          {status.label}
        </p>
      </header>

      {usage ? (
        <p className="practice__usage">
          {usage.used} of {usage.cap} practice requests used today
        </p>
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {stage === "loading" ? (
        <section className="question-sheet question-sheet--loading" aria-hidden="true">
          <span className="skeleton skeleton--text" style={{ width: "30%" }} />
          <span className="skeleton skeleton--title" style={{ width: "90%" }} />
          <span className="skeleton skeleton--title" style={{ width: "65%" }} />
        </section>
      ) : null}

      {retryOf ? (
        <p className="notice" role="status">
          Second attempt at this question. It will be marked and compared with
          your first, but kept out of your progress trend.
        </p>
      ) : null}

      {question && stage !== "loading" && stage !== "finished" ? (
        <QuestionPanel question={question} />
      ) : null}

      {stage === "prep" ? (
        <section className="card prep">
          <PrepRing msLeft={prepMsLeft} totalMs={PART2_PREP_MS} />
          <div className="prep__text">
            <h3>Preparation time</h3>
            <p className="muted">
              Make notes on paper if you like. You then speak for up to two
              minutes.
            </p>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setStage("ready")}
            >
              Skip preparation
            </button>
          </div>
          {/* Spoken at milestones only. Announcing every second, as this
              used to, floods a screen reader with sixty interruptions. */}
          <p className="visually-hidden" role="status" aria-live="polite">
            {prepAnnouncement(prepMsLeft)}
          </p>
        </section>
      ) : null}

      {stage === "ready" && question ? (
        <section className={`dock${recording ? " dock--recording" : ""}`}>
          <Recorder
            onComplete={submit}
            onRecordingChange={setRecording}
            softLimitMs={part === 2 ? PART2_SOFT_LIMIT_MS : undefined}
            label={answeredCount === 0 ? "Start recording" : "Record your answer"}
          />
          {!recording ? (
            <p className="dock__hint">
              Stops automatically at three minutes. Audio is sent for marking
              and never saved. Keep the screen on and this tab open while you
              speak.
            </p>
          ) : null}
        </section>
      ) : null}

      {busy ? (
        <section className="card examiner">
          <div className="examiner__visual" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <h3 className="examiner__title">
            {stage === "uploading"
              ? "Sending your answer to the examiner"
              : "The examiner is listening and thinking"}
          </h3>
          <ol className="examiner__steps">
            <li className="is-done">
              <Icon name="check" />
              Recorded
            </li>
            <li className={stage === "uploading" ? "is-current" : "is-done"}>
              {stage === "uploading" ? <span className="examiner__spinner" aria-hidden="true" /> : <Icon name="check" />}
              Uploading
            </li>
            <li className={stage === "evaluating" ? "is-current" : undefined}>
              {stage === "evaluating" ? <span className="examiner__spinner" aria-hidden="true" /> : <span className="examiner__pending" aria-hidden="true" />}
              Marking
            </li>
          </ol>
          <p className="muted">
            {stage === "uploading"
              ? "Uploading your recording."
              : "Marking your answer. This usually takes a few seconds."}{" "}
            Stay on this page. If it fails you can retry without recording
            again.
          </p>
        </section>
      ) : null}

      {stage === "failed" && pending ? (
        <section className="card outcome outcome--failed">
          <div className="outcome__icon" aria-hidden="true">
            <Icon name="alert" />
          </div>
          <div className="outcome__body">
            <h3>That did not go through</h3>
            <p>
              Your recording is still here &mdash;{" "}
              {Math.round(pending.recording.durationSec)} seconds, held in memory
              only. Retrying sends the same audio, and cannot be marked or
              counted against your allowance twice.
            </p>
            <div className="button-row">
              <button type="button" className="button" onClick={retry}>
                <Icon name="refresh" />
                Try again
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={discard}
              >
                Discard and re-record
              </button>
            </div>
            {pending.attempts > 1 ? (
              <p className="muted">
                {pending.attempts} attempts so far. If this keeps failing, check
                your connection or come back in a few minutes.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {stage === "result" && latest ? (
        <>
          <ResultCard
            answerId={latest.answerId}
            question={latest.question}
            transcript={latest.transcript}
            durationSec={latest.durationSec}
            wordCount={latest.wordCount}
            view={latest.view}
          />
          {comparisonFor ? <RetryComparison answerId={comparisonFor} /> : null}

          <div className="practice__actions">
            <button type="button" className="button button--large" onClick={next}>
              {isLastQuestion ? "Finish session" : "Next question"}
              <Icon name="arrowRight" />
            </button>
            {/* A second go at the same question. Kept out of the trend: see
                EXCLUDE_RETRIES in lib/db/progress.ts. */}
            <button
              type="button"
              className="button button--quiet button--large"
              onClick={tryAgain}
            >
              <Icon name="refresh" />
              Try this question again
            </button>
          </div>
        </>
      ) : null}

      {stage === "finished" ? (
        <section className="card outcome outcome--done">
          <div className="outcome__icon" aria-hidden="true">
            <Icon name="check" />
          </div>
          <div className="outcome__body">
            <h3>Session complete</h3>
            <p>
              You answered {answeredCount} {answeredCount === 1 ? "question" : "questions"}.
              Everything is saved.
            </p>
            <div className="button-row">
              {sessionId ? (
                <Link className="button" href={`/history/${sessionId}`}>
                  Review this session
                </Link>
              ) : null}
              <Link className="button button--quiet" href="/practice">
                Practise again
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type Tone = "neutral" | "accent" | "danger" | "success" | "warning";

/** What the status chip says for each stage. Display only. */
function stageStatus(stage: Stage, recording: boolean): { label: string; tone: Tone } {
  switch (stage) {
    case "loading":
      return { label: "Preparing question", tone: "neutral" };
    case "prep":
      return { label: "Preparation", tone: "accent" };
    case "ready":
      return recording
        ? { label: "Recording", tone: "danger" }
        : { label: "Ready to record", tone: "neutral" };
    case "uploading":
      return { label: "Uploading", tone: "accent" };
    case "evaluating":
      return { label: "Marking", tone: "accent" };
    case "failed":
      return { label: "Not sent", tone: "warning" };
    case "result":
      return { label: "Marked", tone: "success" };
    case "finished":
      return { label: "Session complete", tone: "success" };
  }
}

/**
 * The preparation countdown, for a screen reader. The text only changes at
 * 60, 45, 30, 15 and 5 seconds and at the end, so a polite live region speaks
 * six times in the minute instead of sixty.
 */
function prepAnnouncement(ms: number): string {
  if (ms <= 0) return "Preparation time finished.";
  const seconds = Math.ceil(ms / 1000);
  const milestone = [60, 45, 30, 15, 5].find(
    (mark, index, marks) => seconds <= mark && (index === marks.length - 1 || seconds > marks[index + 1]),
  );
  return `${milestone ?? seconds} seconds of preparation left.`;
}

function QuestionPanel({ question }: { question: QuestionResponse }) {
  if (question.part === 2) {
    return (
      <section className="cue-card" aria-labelledby="cue-card-prompt">
        <p className="eyebrow">Cue card &middot; {question.topic}</p>
        <h2 id="cue-card-prompt" className="cue-card__prompt">
          {question.prompt}
        </h2>
        <p className="cue-card__say">You should say:</p>
        <ul className="cue-card__bullets">
          {question.bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="question-sheet">
      <p className="eyebrow">{question.topic}</p>
      <h2 className="question-sheet__text">{question.question}</h2>
    </section>
  );
}

/** The exact wording stored with the answer and sent for marking. */
function toQuestionText(question: QuestionResponse): string {
  if (question.part === 2) {
    return [
      question.prompt,
      "You should say:",
      ...question.bullets.map((bullet) => `- ${bullet}`),
    ].join("\n");
  }
  return question.question;
}
