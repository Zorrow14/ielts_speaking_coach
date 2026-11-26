"use client";

/**
 * MediaRecorder wrapper. Owns the microphone, the clock and the hard stop;
 * knows nothing about IELTS or the API.
 *
 * Failure modes handled explicitly, because on a phone they are common:
 * permission refused, no microphone present, the device being used by another
 * app, and a browser without MediaRecorder at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_MS,
  formatClock,
  pickRecorderMime,
} from "@/lib/audio";

type RecorderState = "idle" | "starting" | "recording" | "stopping";

export type Recording = { blob: Blob; mimeType: string; durationSec: number };

export default function Recorder({
  onComplete,
  softLimitMs,
  disabled = false,
  label = "Start recording",
}: {
  onComplete: (recording: Recording) => void;
  /** Point at which the UI nudges you to wrap up. Part 2 uses two minutes. */
  softLimitMs?: number;
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanUp = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (hardStopRef.current) clearTimeout(hardStopRef.current);
    tickRef.current = null;
    hardStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Release the microphone if the component goes away mid-recording.
  useEffect(() => cleanUp, [cleanUp]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("stopping");
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser will not give web pages access to the microphone. Try Chrome, Edge or Safari.",
      );
      return;
    }

    const mimeType = pickRecorderMime();
    if (!mimeType) {
      setError(
        "This browser cannot record audio in a format the app can mark. Try Chrome, Edge or Safari.",
      );
      return;
    }

    setState("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setState("idle");
      setError(microphoneErrorMessage(cause));
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      cleanUp();
      setState("idle");
      setError("This browser refused to start a recording in a usable format.");
      return;
    }

    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      cleanUp();
      setState("idle");
      setError("The recording stopped unexpectedly. Please try again.");
    };

    recorder.onstop = () => {
      const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      cleanUp();
      setState("idle");
      setElapsedMs(0);

      if (blob.size === 0) {
        setError("Nothing was recorded. Check your microphone and try again.");
        return;
      }
      onComplete({ blob, mimeType, durationSec });
    };

    startedAtRef.current = Date.now();
    recorder.start();
    setState("recording");
    setElapsedMs(0);

    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);

    // Hard stop. Keeps the upload inside the request body limit and matches
    // the plan's three-minute cap.
    hardStopRef.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [cleanUp, onComplete, stop]);

  const recording = state === "recording";
  const pastSoftLimit = softLimitMs !== undefined && elapsedMs >= softLimitMs;
  const remainingMs = Math.max(0, MAX_RECORDING_MS - elapsedMs);

  return (
    <div className="recorder">
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {recording ? (
        <>
          <p className="recorder__clock" aria-live="off">
            <span className="recorder__dot" aria-hidden="true" />
            {formatClock(elapsedMs)}
            <span className="muted"> / hard stop in {formatClock(remainingMs)}</span>
          </p>
          {pastSoftLimit ? (
            <p className="alert alert--soft" role="status">
              You have passed two minutes. Finish your point and stop.
            </p>
          ) : null}
          <button type="button" className="button" onClick={stop}>
            Stop and submit
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button"
          onClick={start}
          disabled={disabled || state !== "idle"}
        >
          {state === "starting" ? "Waiting for microphone..." : label}
        </button>
      )}
    </div>
  );
}

/** Turns a getUserMedia rejection into something a learner can act on. */
function microphoneErrorMessage(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Allow it for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one, or check your phone's input settings.";
    case "NotReadableError":
      return "Your microphone is busy in another app. Close that app and try again.";
    case "AbortError":
      return "The microphone could not be started. Try again.";
    default:
      return "The microphone could not be opened. Check your browser's site permissions and try again.";
  }
}
