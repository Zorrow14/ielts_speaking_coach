"use client";

/**
 * MediaRecorder wrapper. Owns the microphone, the clock and the hard stop;
 * knows nothing about IELTS or the API.
 *
 * Failure modes handled explicitly, because on a phone they are common:
 *
 *   - permission refused, or revoked in site settings
 *   - no microphone present
 *   - the device being used by another app
 *   - a browser without MediaRecorder at all
 *   - the microphone being taken away MID-RECORDING (a call arrives, another
 *     app grabs it, the user revokes permission): the track fires "ended", and
 *     whatever was captured up to that point is still handed over rather than
 *     thrown away
 *   - the tab being hidden or the phone locked: iOS in particular suspends
 *     media capture, so the recording is stopped deliberately and the learner
 *     is told, instead of silently producing a truncated or empty file
 *   - MediaRecorder stopping on its own
 *
 * The clock is computed from Date.now(), not by accumulating interval ticks,
 * so a throttled or suspended timer in a backgrounded tab cannot make the
 * elapsed time drift - it corrects itself as soon as the tab is visible again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_MS,
  formatClock,
  pickRecorderMime,
} from "@/lib/audio";

type RecorderState = "idle" | "starting" | "recording" | "stopping";

/** Why the recording ended, so the parent can explain it. */
export type StopReason =
  | "user"
  | "hard_limit"
  | "mic_lost"
  | "page_hidden"
  | "browser";

export type Recording = {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  reason: StopReason;
};

/** Announce the clock this often, rather than on every 200ms tick. */
const ANNOUNCE_EVERY_MS = 30_000;

export default function Recorder({
  onComplete,
  softLimitMs,
  hardLimitMs = MAX_RECORDING_MS,
  disabled = false,
  label = "Start recording",
}: {
  onComplete: (recording: Recording) => void;
  /** Point at which the UI nudges you to wrap up. Part 2 uses two minutes. */
  softLimitMs?: number;
  /**
   * When recording is cut off. Defaults to the owner's three minutes; guest
   * mode passes a shorter ceiling, which the server enforces independently -
   * this is the courtesy, not the control.
   */
  hardLimitMs?: number;
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedAtRef = useRef(0);
  /** Set before stop() so onstop knows why it is running. */
  const reasonRef = useRef<StopReason>("user");

  const cleanUp = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (hardStopRef.current) clearTimeout(hardStopRef.current);
    tickRef.current = null;
    hardStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Release the microphone if the component goes away mid-recording.
  useEffect(() => cleanUp, [cleanUp]);

  const stop = useCallback((reason: StopReason = "user") => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    reasonRef.current = reason;
    setState("stopping");
    recorder.stop();
  }, []);

  /**
   * A hidden tab cannot be trusted to keep capturing: iOS Safari suspends the
   * audio pipeline, and some Android browsers do too. Stopping deliberately
   * keeps what was captured and makes the reason visible, which is far better
   * than handing over a file that is silently short.
   */
  useEffect(() => {
    if (state !== "recording") return;
    const onHide = () => {
      if (document.visibilityState === "hidden") stop("page_hidden");
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [state, stop]);

  const start = useCallback(async () => {
    setError(null);
    setAnnouncement("");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser will not give web pages access to the microphone. Try Chrome, Edge or Safari.",
      );
      return;
    }

    // A secure context is required for getUserMedia everywhere except
    // localhost, and the failure is otherwise a confusing NotAllowedError.
    if (!window.isSecureContext) {
      setError(
        "The microphone needs a secure (https) connection. Open the deployed site rather than a plain http address.",
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
    reasonRef.current = "user";

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

    // The microphone being taken away mid-recording. Stop cleanly so the
    // audio captured so far survives.
    for (const track of stream.getAudioTracks()) {
      track.onended = () => stop("mic_lost");
    }

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
      const reason = reasonRef.current;
      chunksRef.current = [];
      cleanUp();
      setState("idle");
      setElapsedMs(0);

      if (blob.size === 0) {
        setError(
          reason === "page_hidden"
            ? "Nothing was recorded - the page was hidden before any audio was captured. Keep this tab open and the screen on while you speak."
            : "Nothing was recorded. Check your microphone and try again.",
        );
        return;
      }

      // Each of these still hands the audio over: a short answer can be
      // marked, and the parent decides what to say about it.
      if (reason === "mic_lost") {
        setError(
          "The microphone was disconnected, so the recording stopped early. What you said up to that point has been kept.",
        );
      } else if (reason === "page_hidden") {
        setError(
          "Recording stopped because the page was hidden or the screen locked. What you said up to that point has been kept - keep the screen on next time.",
        );
      }

      onComplete({ blob, mimeType, durationSec, reason });
    };

    startedAtRef.current = Date.now();
    announcedAtRef.current = 0;
    recorder.start();
    setState("recording");
    setElapsedMs(0);

    tickRef.current = setInterval(() => {
      // Derived from the start timestamp, so a throttled interval in a
      // dimmed or backgrounded tab cannot make this drift.
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed - announcedAtRef.current >= ANNOUNCE_EVERY_MS) {
        announcedAtRef.current = elapsed;
        setAnnouncement(`Recording: ${formatClock(elapsed)} elapsed.`);
      }
    }, 200);

    // Hard stop. Keeps the upload inside the request body limit and matches
    // the plan's three-minute cap.
    hardStopRef.current = setTimeout(() => stop("hard_limit"), hardLimitMs);
  }, [cleanUp, hardLimitMs, onComplete, stop]);

  const recording = state === "recording";
  const pastSoftLimit = softLimitMs !== undefined && elapsedMs >= softLimitMs;
  const remainingMs = Math.max(0, hardLimitMs - elapsedMs);

  return (
    <div className="recorder">
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        The clock itself is aria-hidden and updates four times a second, which
        would be unusable with a screen reader. This region carries the same
        information every 30 seconds instead.
      */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {recording ? (
        <>
          <p className="recorder__clock" aria-hidden="true">
            <span className="recorder__dot" />
            {formatClock(elapsedMs)}
            <span className="muted"> / hard stop in {formatClock(remainingMs)}</span>
          </p>
          {pastSoftLimit ? (
            <p className="alert alert--soft" role="status">
              You have passed two minutes. Finish your point and stop.
            </p>
          ) : null}
          <button type="button" className="button" onClick={() => stop("user")}>
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
