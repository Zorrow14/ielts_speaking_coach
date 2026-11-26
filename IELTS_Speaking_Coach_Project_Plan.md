# IELTS Speaking Coach: Project Plan

Next.js + Neon Postgres + Gemini API, deployed on Vercel. Plan date: 26 Nov 2026.

## 1. Goal and scope

A personal web app that simulates the three IELTS Speaking parts, records the user's answer, and returns a strict, criterion-based estimate with transcripts, mistakes, and progress over time. Built for one user now, with a data model that can support other users later. Scores are AI estimates, not official IELTS results.

**In scope (MVP):**
- Part 1, 2, 3 modes
- Part 2 timers (1 min prep, 2 min talk)
- Voice recording
- Structured feedback
- Saved history
- Mistake log
- Progress charts
- Vocabulary notebook

**Out of scope for now:** real-time Gemini Live conversation, saved audio, public sign-up, payments.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Framework / host | Next.js (App Router), deployed on Vercel |
| Database | Neon serverless Postgres via the Vercel integration (`DATABASE_URL`), Drizzle ORM, `@neondatabase/serverless` driver |
| AI | Gemini API, called server-side only. Audio in, transcript + JSON feedback out, in one request |
| Auth | Auth.js (single user now). Every table carries `user_id` from day one |
| Stored data | Transcripts and feedback only. Audio is discarded after the request |
| Browser storage | None for app data (no localStorage); everything persists in Neon |

## 3. Architecture

- **Browser:** records audio with `MediaRecorder`, shows timers and the examiner flow, renders feedback and charts.
- **API routes (server):** hold the Gemini key, generate questions, evaluate audio, read and write Neon.
- **Neon Postgres:** sessions, answers, feedback, mistakes, vocabulary. Neon branching gives a safe test database.
- **Gemini:** generates questions and cue cards, transcribes the audio, and returns feedback as schema-constrained JSON.

## 4. Database schema

| Table | Key columns |
|---|---|
| `users` | id, email, created_at |
| `sessions` | id, user_id, part (1/2/3), topic, started_at |
| `answers` | id, session_id, question, transcript, duration_sec, word_count |
| `feedback` | id, answer_id, fluency, lexical, grammar, pronunciation_est, overall, strengths (json), next_steps (json), raw_json |
| `mistakes` | id, answer_id, category (grammar / vocab / fluency), original, correction, explanation |
| `vocab_notebook` | id, user_id, phrase, meaning, example, source_answer_id |

Progress charts read from `feedback`; the most repeated mistakes come from `mistakes`. All queries filter by `user_id`.

## 5. API routes

| Route | Purpose |
|---|---|
| `POST /api/question` | Returns a Part 1 question, a Part 2 cue card, or a Part 3 follow-up based on the previous answer |
| `POST /api/evaluate` | Receives audio, calls Gemini once for transcript and JSON feedback, saves to Neon, returns the result. Daily request cap applies |
| `GET /api/progress` | Score trends, repeated mistakes, session history |
| `GET/POST /api/vocab` | Read and add vocabulary notebook entries |

## 6. Build phases (about 5 to 6 evenings)

| Phase | Work | Done when |
|---|---|---|
| 1. Setup (Day 1) | Next.js project, Neon connected, Drizzle schema and migrations, Auth.js login, first Vercel deploy | Logged-in empty app is live on Vercel and can write a row to Neon |
| 2. Core loop (Days 2-3) | Recording, Part 2 timers, Part 1 and Part 3 flow, `/api/evaluate` pipeline with saved results | A full Part 2 attempt is recorded, evaluated, and saved |
| 3. Feedback quality (Day 4) | Strict examiner prompt, enforced JSON schema, "estimate, not official" label | Scores are consistent and not inflated on test answers |
| 4. Progress and notebook (Day 5) | Charts, mistake history, vocabulary notebook | Trends and repeated mistakes display from real data |
| 5. Hardening (Day 6) | Mic-permission and upload error handling, daily request cap, mobile layout check | App works on phone and fails gracefully |

## 7. Feedback design

- Four criteria: Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation (indicator only).
- Prompt contains the band descriptors, tells Gemini never to round up, and requires specific mistakes with corrections.
- The learner answers first; model answers appear only after evaluation, per the tutoring rules.
- Output is validated against a JSON schema before it is saved; invalid output triggers one retry.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Generous scoring | Descriptors in prompt, no-rounding rule, compare early outputs against your own judgment |
| Weak pronunciation signal | Show as an indicator, never as an official band; use a human teacher or native audio for real pronunciation work |
| Upload size | Vercel request body limit is about 4.5 MB; a 2-minute compressed recording is well below it. Cap recordings at about 3 minutes |
| API key exposure | Key only in Vercel environment variables; Gemini never called from the browser |
| Quota / cost | Daily cap per user on `/api/evaluate`; check current Gemini free-tier limits before relying on them |
| Scope creep | If the build passes a week, cut charts and the vocabulary notebook first. Practice time matters more than features |

## 9. Later, for other users

- Open sign-up, per-user daily limits, and a privacy note (audio is processed by Google's API; only text is kept).
- Row-level checks on every query, plus optional Gemini Live API for a real-time examiner experience.

## 10. Next step

Scaffold phase 1 (Next.js, Drizzle schema, Neon connection, Auth.js, first deploy). Confirm whether to build in a local folder or directly in a GitHub repo.
