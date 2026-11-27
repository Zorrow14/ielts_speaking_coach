/**
 * One time zone for the whole app.
 *
 * "Day" boundaries matter here: a practice streak, answers-per-day and the
 * last-7-days mistake window all have to agree about when a day starts, and
 * the database stores everything in UTC. Every query that groups by day casts
 * through this constant, and every date the UI formats uses it too.
 *
 * Note that the daily request cap in lib/rate-limit.ts deliberately does NOT
 * use this: that window is UTC, because it mirrors the provider's own quota
 * reset rather than the learner's calendar.
 */
export const APP_TIME_ZONE = "Asia/Kuala_Lumpur";

/** Dates as the learner sees them, not as Postgres stores them. */
export const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: APP_TIME_ZONE,
});

export const DAY_SHORT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: APP_TIME_ZONE,
});

export const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: APP_TIME_ZONE,
});
