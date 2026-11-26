/**
 * Audio handling rules shared by the recorder and /api/evaluate.
 *
 * The browser decides the container: Chrome and Android give WebM/Opus,
 * Safari gives MP4/AAC. Gemini's accepted audio MIME list covers WebM, OGG,
 * M4A and friends but not the literal string `audio/mp4`, so Safari's label is
 * mapped to `audio/m4a` - the same ISO base media container under the name
 * Gemini accepts.
 */

/** Hard stop for a recording. Plan section 8: cap around three minutes. */
export const MAX_RECORDING_MS = 3 * 60 * 1000;

/** Part 2 should run to two minutes; past that the UI nudges you to stop. */
export const PART2_SOFT_LIMIT_MS = 2 * 60 * 1000;

/** Part 2 preparation time. */
export const PART2_PREP_MS = 60 * 1000;

/**
 * Vercel caps a request body at about 4.5 MB. Three minutes of Opus is well
 * under 4 MB, so this rejects only pathological uploads.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Candidate recorder types, best first. The browser picks the first it supports. */
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
];

/** MIME types Gemini accepts for audio input. */
const GEMINI_AUDIO_MIME = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/m4a",
  "audio/opus",
  "audio/webm",
]);

/** Browser labels that mean the same container under a different name. */
const MIME_ALIASES: Record<string, string> = {
  "audio/mp4": "audio/m4a",
  "audio/x-m4a": "audio/m4a",
  "audio/mp4a-latm": "audio/m4a",
  "audio/vorbis": "audio/ogg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
};

/**
 * Turns a browser MIME label into one Gemini accepts, or null if we cannot.
 * Strips any codecs parameter, which Gemini does not expect.
 */
export function normaliseAudioMime(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  const base = (raw.split(";")[0] ?? "").trim().toLowerCase();
  const mapped = MIME_ALIASES[base] ?? base;
  return GEMINI_AUDIO_MIME.has(mapped) ? mapped : null;
}

/** Picks a recording type the current browser actually supports. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_CANDIDATES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ":" + seconds.toString().padStart(2, "0");
}
