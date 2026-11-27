/**
 * Guest mode configuration. Every limit is an env var with a default, so they
 * can be tightened without a deploy.
 *
 * GUEST_MODE_ENABLED defaults to FALSE. That is deliberate: guest mode exposes
 * a paid AI endpoint to the open internet, so it fails closed exactly like
 * ALLOWED_EMAILS does. Setting it to "true" is an explicit act.
 */

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

function positiveInt(name: string, fallback: number, max?: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max === undefined ? parsed : Math.min(parsed, max);
}

/** The kill switch. False means every guest route returns 404. */
export function guestModeEnabled(): boolean {
  return flag("GUEST_MODE_ENABLED", false);
}

/**
 * Whether the Gemini key is on paid quota.
 *
 * This only changes what the privacy page claims, and it is here rather than
 * inferred because the app cannot detect its own billing status. If you enable
 * billing, set it; if you do not, the page tells guests the truth about the
 * free tier.
 */
export function geminiPaidTier(): boolean {
  return flag("GEMINI_PAID_TIER", false);
}

export type GuestLimits = {
  evaluationsPerToken: number;
  questionsPerToken: number;
  evaluationsPerIp: number;
  globalEvaluations: number;
  tokenTtlHours: number;
  maxRecordingSecPart13: number;
  maxRecordingSecPart2: number;
  maxAudioBytes: number;
};

export function guestLimits(): GuestLimits {
  return {
    evaluationsPerToken: positiveInt("GUEST_EVALUATIONS_PER_TOKEN", 3),
    questionsPerToken: positiveInt("GUEST_QUESTIONS_PER_TOKEN", 10),
    evaluationsPerIp: positiveInt("GUEST_EVALUATIONS_PER_IP", 5),
    /** The one that protects the bill. Across ALL guests, per UTC day. */
    globalEvaluations: positiveInt("GUEST_GLOBAL_EVALUATIONS", 100),
    /** Capped at 24 regardless of what the env var says. */
    tokenTtlHours: positiveInt("GUEST_TOKEN_TTL_HOURS", 24, 24),
    maxRecordingSecPart13: positiveInt("GUEST_MAX_SEC_PART13", 90),
    maxRecordingSecPart2: positiveInt("GUEST_MAX_SEC_PART2", 120),
    /** Tighter than the owner's 4 MB, because guest answers are shorter. */
    maxAudioBytes: positiveInt("GUEST_MAX_AUDIO_BYTES", 3 * 1024 * 1024),
  };
}

/** The recording ceiling for a part, in seconds. */
export function maxRecordingSec(part: 1 | 2 | 3, limits = guestLimits()): number {
  return part === 2 ? limits.maxRecordingSecPart2 : limits.maxRecordingSecPart13;
}

/** Slack on the client-reported duration, for the tail chunk and clock skew. */
export const DURATION_TOLERANCE_SEC = 10;
