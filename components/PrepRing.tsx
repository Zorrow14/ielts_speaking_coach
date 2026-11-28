/**
 * The Part 2 preparation minute, as a ring that empties.
 *
 * Driven by the countdown PracticeSession already keeps from Date.now(), not
 * by a CSS animation of its own: a separate 60-second animation would drift
 * from the real clock whenever the tab is throttled, and the ring and the
 * number would disagree. A short linear transition only smooths the step
 * between 200ms ticks; under reduced motion it simply steps.
 *
 * Purely visual. The screen-reader announcement of the time left lives with
 * the countdown in PracticeSession, where it already was.
 */
import type { CSSProperties } from "react";
import { formatClock } from "@/lib/audio";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function PrepRing({
  msLeft,
  totalMs,
}: {
  msLeft: number;
  totalMs: number;
}) {
  const remaining = Math.max(0, Math.min(1, msLeft / totalMs));

  return (
    <div className="prep-ring" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="prep-ring__svg">
        <circle className="prep-ring__track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="prep-ring__arc"
          cx="60"
          cy="60"
          r={RADIUS}
          style={
            {
              strokeDasharray: CIRCUMFERENCE,
              "--offset": (CIRCUMFERENCE * (1 - remaining)).toFixed(2),
            } as CSSProperties
          }
        />
      </svg>
      <span className="prep-ring__clock">{formatClock(msLeft)}</span>
    </div>
  );
}
