/**
 * Database schema - plan section 4.
 *
 * Every user-owned table carries `user_id` even where it could be derived by
 * joining upwards. The app has one user today; carrying the column from day one
 * means every query can filter on it directly and multi-user needs no migration.
 *
 * Band scores are numeric(2,1) so half bands (6.5) round-trip exactly.
 */
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const mistakeCategory = pgEnum("mistake_category", [
  "grammar",
  "vocab",
  "fluency",
]);

/** Routes that consume Gemini quota and are therefore counted against the cap. */
export const apiRoute = pgEnum("api_route", ["question", "evaluate"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

/** One examiner session = one attempt at Part 1, 2 or 3. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    part: smallint("part").notNull(),
    topic: text("topic"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("sessions_part_valid", sql`${t.part} between 1 and 3`),
    index("sessions_user_started_idx").on(t.userId, t.startedAt),
  ],
);

/** One question and the transcript of the spoken answer. Audio is never stored. */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    transcript: text("transcript").notNull(),
    durationSec: integer("duration_sec"),
    wordCount: integer("word_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("answers_session_idx").on(t.sessionId),
    index("answers_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Gemini's scored feedback for one answer. `pronunciationEst` is an indicator
 * only and must never be shown as an official band. `rawJson` keeps the
 * validated model output so the display can change without re-evaluating.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fluency: numeric("fluency", { precision: 2, scale: 1 }).notNull(),
    lexical: numeric("lexical", { precision: 2, scale: 1 }).notNull(),
    grammar: numeric("grammar", { precision: 2, scale: 1 }).notNull(),
    pronunciationEst: numeric("pronunciation_est", {
      precision: 2,
      scale: 1,
    }).notNull(),
    overall: numeric("overall", { precision: 2, scale: 1 }).notNull(),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    nextSteps: jsonb("next_steps").$type<string[]>().notNull().default([]),
    rawJson: jsonb("raw_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_answer_idx").on(t.answerId),
    index("feedback_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** One specific mistake with its correction. Drives repeated-mistake analysis. */
export const mistakes = pgTable(
  "mistakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: mistakeCategory("category").notNull(),
    original: text("original").notNull(),
    correction: text("correction").notNull(),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mistakes_answer_idx").on(t.answerId),
    index("mistakes_user_category_idx").on(t.userId, t.category),
  ],
);

export const vocabNotebook = pgTable(
  "vocab_notebook",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phrase: text("phrase").notNull(),
    meaning: text("meaning"),
    example: text("example"),
    /** Null when added by hand rather than captured from an answer. */
    sourceAnswerId: uuid("source_answer_id").references(() => answers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("vocab_user_created_idx").on(t.userId, t.createdAt)],
);

/**
 * One row per Gemini-backed request, written before the call so that failed
 * calls still count - they cost quota too. The daily cap is counted from here
 * rather than from `answers`, which only records successful evaluations.
 */
export const apiRequests = pgTable(
  "api_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    route: apiRoute("route").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_requests_user_created_idx").on(t.userId, t.createdAt)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  answers: many(answers),
  vocab: many(vocabNotebook),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  answers: many(answers),
}));

export const answersRelations = relations(answers, ({ one, many }) => ({
  session: one(sessions, {
    fields: [answers.sessionId],
    references: [sessions.id],
  }),
  user: one(users, { fields: [answers.userId], references: [users.id] }),
  feedback: one(feedback),
  mistakes: many(mistakes),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
  answer: one(answers, {
    fields: [feedback.answerId],
    references: [answers.id],
  }),
  user: one(users, { fields: [feedback.userId], references: [users.id] }),
}));

export const mistakesRelations = relations(mistakes, ({ one }) => ({
  answer: one(answers, {
    fields: [mistakes.answerId],
    references: [answers.id],
  }),
  user: one(users, { fields: [mistakes.userId], references: [users.id] }),
}));

export const vocabNotebookRelations = relations(vocabNotebook, ({ one }) => ({
  user: one(users, { fields: [vocabNotebook.userId], references: [users.id] }),
  sourceAnswer: one(answers, {
    fields: [vocabNotebook.sourceAnswerId],
    references: [answers.id],
  }),
}));
