"use client";

/**
 * A live microphone level meter, as a progressive enhancement.
 *
 * Contract, because the recorder is the one thing in this app that must not
 * break:
 *
 *   - prepare() is called SYNCHRONOUSLY inside the "Start recording" tap,
 *     before anything is awaited. iOS Safari only lets an AudioContext run if
 *     it was created or resumed inside a user gesture; after the
 *     getUserMedia await the gesture is gone.
 *   - attach() is called only AFTER MediaRecorder has started, so nothing the
 *     meter does can delay or prevent a recording.
 *   - The analyser is never connected to the destination. No sound is played,
 *     so there is no feedback loop and no change to the audio being recorded.
 *   - It reads loudness per animation frame into the DOM and keeps nothing.
 *     No audio is stored, buffered, or sent anywhere.
 *   - Every Web Audio call is guarded. If any of it fails - no AudioContext,
 *     a context that stays suspended, a browser that refuses
 *     createMediaStreamSource - `active` stays false and the UI shows the
 *     plain recording dot instead. The recording carries on regardless.
 *
 * Bars are written straight to the DOM through refs rather than React state:
 * sixty re-renders a second for a meter would be wasteful.
 */
import { useCallback, useRef, useState } from "react";

/** Number of bars in the meter. */
export const METER_BARS = 7;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function useLevelMeter() {
  const [active, setActive] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  /** Inside the tap, before any await. Never throws. */
  const prepare = useCallback(() => {
    try {
      const Context =
        window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      // resume() returns a promise; it is started here, inside the gesture,
      // which is what iOS requires. Its result is checked in attach().
      void context.resume().catch(() => undefined);
      contextRef.current = context;
    } catch {
      contextRef.current = null;
    }
  }, []);

  const detach = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    try {
      sourceRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    sourceRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    setActive(false);
  }, []);

  /** After MediaRecorder.start(). Never throws. */
  const attach = useCallback(
    (stream: MediaStream) => {
      const context = contextRef.current;
      if (!context) return;
      try {
        // A context the browser kept suspended would just draw flat bars,
        // which reads as "the microphone is not working". Show the plain dot
        // instead.
        if (context.state !== "running") {
          detach();
          return;
        }

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        // Deliberately NOT connected to context.destination: nothing is played.
        source.connect(analyser);
        sourceRef.current = source;

        const bins = new Uint8Array(analyser.frequencyBinCount);
        // Speech sits roughly in the lower third of the spectrum at this FFT
        // size; spreading the bars across it keeps all of them moving.
        const usable = Math.floor(bins.length / 3);
        const perBar = Math.max(1, Math.floor(usable / METER_BARS));

        const draw = () => {
          analyser.getByteFrequencyData(bins);
          for (let bar = 0; bar < METER_BARS; bar += 1) {
            let sum = 0;
            for (let i = 0; i < perBar; i += 1) sum += bins[bar * perBar + i] ?? 0;
            // 0..1, with a floor so silence still shows short bars rather
            // than an empty box.
            const level = Math.min(1, sum / perBar / 200);
            const element = barsRef.current[bar];
            if (element) {
              element.style.setProperty("--level", (0.12 + level * 0.88).toFixed(3));
            }
          }
          frameRef.current = requestAnimationFrame(draw);
        };
        frameRef.current = requestAnimationFrame(draw);
        setActive(true);
      } catch {
        detach();
      }
    },
    [detach],
  );

  return { active, prepare, attach, detach, barsRef };
}
