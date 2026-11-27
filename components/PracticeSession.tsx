"use client";

/**
 * Drives one practice attempt for a single part.
 *
 * All state is in React memory and the database. Nothing is kept in
 * localStorage or sessionStorage, so a refresh abandons the attempt - the
 * answers already marked are safe in Neon and show up in history.
 *
 * No model answer is ever generated or shown; the only feedback appears after
 * the user has recorded and submitted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Recorder, { type Recording } from "./Recorder";
import ResultCard from "./ResultCard";
import { PART2_PREP_MS, PART2_SOFT_LIMIT_MS, formatClock } from "@/lib/audio";
import { buildResultView, type ResultView } from "@/lib/result-view";
import type { Evaluation, Part, QuestionResponse } from "@/lib/schemas";
import type { Scored } from "@/lib/scoring";

/** How many questions make up a session, per part. */
const QUESTIONS_PER_SESSION: Record<Part, number> = { 1: 4, 2: 1, 3: 4 };

type Stage =
  | "loading"
  | "prep"
  | "ready"
  | "evaluating"
  | "result"
  | "finished";

type MarkedAnswer = {
  /** The saved answer id, which the band 7.5 example is requested against. */
  answerId: string;
  question: string;
  transcript: string;
  durationSec: number;
  wordCount: number;
  view: ResultView;
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

  // The transcript of the previous answer, which Part 3 follow-ups build on.
  const previousRef = useRef<{ question: string; transcript: string } | null>(
    null,
  );
  const requestedRef = useRef(false);

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

  // Part 2 preparation countdown.
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

  const submit = useCallback(
    async (recording: Recording) => {
      if (!question) return;
      setStage("evaluating");
      setError(null);

      const form = new FormData();
      // Sent as multipart, not base64 JSON: smaller and streamable.
      form.append("audio", recording.blob, "answer");
      form.append("question", questionText);
      form.append("part", String(part));
      form.append("durationSec", String(recording.durationSec));
      form.append("topic", question.topic);
      if (sessionId) form.append("sessionId", sessionId);

      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          body: form,
        });
        const data = await response.json();

        if (data.sessionId && !sessionId) setSessionId(data.sessionId);

        if (!response.ok) {
          setError(data.error ?? "Marking failed.");
          setStage("ready");
          return;
        }
        if (data.usage) setUsage(data.usage);

        const evaluation = data.evaluation as Evaluation;
        const transcript = evaluation.transcript.trim();
        const marked: MarkedAnswer = {
          answerId: data.answerId as string,
          question: questionText,
          transcript: evaluation.transcript,
          durationSec: recording.durationSec,
          wordCount: transcript ? transcript.split(/\s+/).length : 0,
          // The bands come from the server's computed `scored`, not from the
          // model output, so the guardrail caps are reflected here too.
          view: buildResultView({
            evaluation,
            scored: data.scored as Scored,
            provenance: data.provenance as {
              promptVersion: string;
              model: string;
            },
          }),
        };

        previousRef.current = {
          question: questionText,
          transcript: evaluation.transcript,
        };
        setLatest(marked);
        setAnswered((previous) => [...previous, marked]);
        setStage("result");
      } catch {
        setError("The upload failed. Check your connection and try again.");
        setStage("ready");
      }
    },
    [part, question, questionText, sessionId],
  );

  const answeredCount = answered.length;
  const isLastQuestion = answeredCount >= total;

  const next = useCallback(() => {
    if (isLastQuestion) {
      setStage("finished");
      return;
    }
    setLatest(null);
    void loadQuestion();
  }, [isLastQuestion, loadQuestion]);

  return (
    <div className="practice">
      <header className="practice__header">
        <p className="muted">
          Part {part} &middot; answer {Math.min(answeredCount + 1, total)} of {total}
          {usage ? ` · ${usage.used}/${usage.cap} requests used today` : ""}
        </p>
      </header>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {stage === "loading" ? <p>Preparing your question...</p> : null}

      {question && stage !== "loading" && stage !== "finished" ? (
        <QuestionPanel question={question} />
      ) : null}

      {stage === "prep" ? (
        <section className="card">
          <h3>Preparation time</h3>
          <p className="big-clock">{formatClock(prepMsLeft)}</p>
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
        </section>
      ) : null}

      {stage === "ready" && question ? (
        <section className="card">
          <Recorder
            onComplete={submit}
            softLimitMs={part === 2 ? PART2_SOFT_LIMIT_MS : undefined}
            label={answeredCount === 0 ? "Start recording" : "Record your answer"}
          />
          <p className="muted">
            Recording stops automatically at three minutes. Audio is sent for
            marking and never saved.
          </p>
        </section>
      ) : null}

      {stage === "evaluating" ? (
        <section className="card">
          <p>Marking your answer. This usually takes a few seconds.</p>
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
          <button type="button" className="button" onClick={next}>
            {isLastQuestion ? "Finish session" : "Next question"}
          </button>
        </>
      ) : null}

      {stage === "finished" ? (
        <section className="card">
          <h3>Session complete</h3>
          <p>
            You answered {answeredCount} {answeredCount === 1 ? "question" : "questions"}.
            Everything is saved.
          </p>
          <div className="row">
            {sessionId ? (
              <Link className="button" href={`/history/${sessionId}`}>
                Review this session
              </Link>
            ) : null}
            <Link className="button button--quiet" href="/practice">
              Practise again
            </Link>
          </div>
        </section>
      ) : null}
    </div>
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
