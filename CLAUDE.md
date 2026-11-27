# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phase 2 code is in place and committed on `main`, and pushed to https://github.com/Zorrow14/ielts_speaking_coach. On top of phase 1 (Next.js 16 App Router, Drizzle schema, Auth.js GitHub sign-in with every route protected) the app now has:

- `lib/gemini/` — the only module that calls Gemini, via the `interactions` API with structured JSON output and `store: false`.
- `POST /api/question` and `POST /api/evaluate`, both authenticated, both counted against a daily cap.
- A `MediaRecorder` recorder with named errors for each failure mode, a two-minute soft warning and a three-minute hard stop.
- Practice flows for Parts 1, 2 and 3, a results screen, and a history list that reopens saved feedback.

Lint, typecheck and build all pass. What has now been checked against live services:

- `.env.local` exists with all eight values filled in.
- Both migrations (`0000`, `0001`) are applied to **both** Neon branches, `dev` and `production`: 7 tables, 17 indexes, 10 foreign keys, 2 enums, and matching `drizzle.__drizzle_migrations` journals on each.
- The Gemini `interactions` call has been exercised live for both shapes — a Part 1 question, and an evaluation with inline audio — and returns schema-valid JSON.
- The app is deployed on Vercel with all seven environment variables set.

Still unverified end to end: GitHub sign-in against the deployed app, and a full recorded answer through the browser.

`IELTS_Speaking_Coach_Project_Plan.md` (plan date 26 Nov 2026) is the authoritative spec. Read it before making architectural choices; update it when a decision in it changes, and keep this file in sync with what actually exists.

## What this app is

A single-user web app that simulates IELTS Speaking Parts 1, 2 and 3: it records a spoken answer, sends the audio to Gemini once, and gets back a transcript plus criterion-based band estimates, specific mistakes with corrections, and next steps. History, repeated-mistake tracking, progress charts and a vocabulary notebook are built on the stored results.

Scores are AI estimates and must always be labeled as such in the UI — never presented as official IELTS bands. Pronunciation is an indicator only, not a band.

## Hard rules

- **No `localStorage` / `sessionStorage` for app data.** Everything persists in Neon.
- **Never call Gemini from the browser.** The key lives in server environment variables only.
- **Store transcripts and feedback only.** Never save or log audio.
- **Every table has `user_id`, and every query filters by it.**
- **Secrets:** never print or commit `.env*`. Keep a `.env.example` with variable names only.
- Label all scores as estimates. Never present Pronunciation as a real band.

## Architecture (as planned)

Next.js App Router (TypeScript) on Vercel, Neon serverless Postgres via `@neondatabase/serverless` and Drizzle, Auth.js for login, Gemini for generation and evaluation.

Three constraints shape most of the code:

- **Gemini is server-side only.** The browser never calls Gemini; it posts audio to `/api/evaluate`, which does transcription and scoring in a single Gemini request and writes the result to Neon.
- **Audio is never persisted.** `MediaRecorder` captures it, the route forwards it to Gemini, and it is discarded after the response. Only transcripts and feedback are stored. Recordings are capped at ~3 minutes to stay under Vercel's ~4.5 MB request body limit.
- **Postgres is the only store for app data.** Every table carries `user_id` from day one and every query filters on it, even though there is one user today — this is what makes multi-user possible later without a migration.

### Data model

`users` → `sessions` (one per Part attempt) → `answers` (one per question) → `feedback` and `mistakes` (both keyed to an answer). `vocab_notebook` hangs off `users` with an optional `source_answer_id`. Progress charts read `feedback`; repeated-mistake analysis reads `mistakes`. See the plan's schema table for columns.

### API routes

- `POST /api/question` — Part 1 question, Part 2 cue card, or a Part 3 follow-up derived from the previous answer.
- `POST /api/evaluate` — the core pipeline: audio in, one Gemini call, transcript + schema-validated JSON feedback out, saved to Neon. Enforces the per-user daily request cap.
- `GET /api/progress` — score trends, repeated mistakes, session history.
- `GET/POST /api/vocab` — vocabulary notebook.

### Evaluation contract

Gemini's output is validated against a JSON schema before anything is saved; invalid output gets exactly one retry. The prompt carries the band descriptors and an explicit no-rounding-up rule, because the main quality risk is inflated scores. Feedback must name specific mistakes with original, correction, and a short explanation in simple English rather than general advice. The learner always answers before seeing a model answer — model answers appear only after evaluation.

## Environment variables

See `.env.example` for the full list with comments. Phase 1 needs:

- `DATABASE_URL` — Neon pooled connection string. Use a Neon **branch**, not the production branch, for local work and migrations.
- `AUTH_SECRET` — generate with `npx auth secret`.
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — from a GitHub OAuth app. GitHub was chosen as the provider in phase 1.
- `ALLOWED_EMAILS` — comma-separated allow list. This is the single-user lock and it **fails closed**: empty or unset means nobody can sign in.
- `GEMINI_API_KEY` — not used until phase 2.

## Commands

```
npm run dev          # local dev server
npm run build        # production build (Turbopack); runs tsc as part of it
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run db:generate  # generate SQL in drizzle/ from schema changes
npm run db:migrate   # apply pending migrations to the DATABASE_URL target
npm run db:studio    # drizzle-kit studio, browse the data
```

The quality gate before calling a phase done is `npm run lint && npm run typecheck && npm run build`.

Both migrations — `0000` (the six core tables) and `0001` (`api_requests`, which the daily cap counts) — are already applied to the `dev` and `production` branches, so `db:migrate` is a no-op until a new one is generated.

`drizzle-kit migrate` decides what to re-run by comparing the journal's `created_at` against each migration folder's timestamp, not by hash. Note that it normalises CRLF to LF before hashing the SQL file, so a hash computed from the file as it sits on disk (Windows checks these out as CRLF) will not match the stored one.

`drizzle.config.ts` loads `.env.local` with `process.loadEnvFile`, so `db:*` commands pick up the same `DATABASE_URL` as the app without a dotenv dependency. **`db:migrate` writes to whatever `DATABASE_URL` points at** — check it is a Neon branch first.

There is a moderate `npm audit` advisory (esbuild, via drizzle-kit's bundled transpiler). It is dev-tooling only and `npm audit fix --force` downgrades drizzle-kit to 0.18, so it is deliberately left alone.

## Build order

The plan sequences work as: setup → core record/evaluate loop → feedback quality → progress and notebook → hardening (mic permission and upload errors, daily cap, mobile layout). If time runs short, charts and the vocabulary notebook are the first things to cut.

## Working style

- Build one phase at a time. Stop at each phase's "done when" (plan section 6) and show how to verify it.
- Keep it simple. Do not add libraries or features outside the plan without asking.
- Run lint, typecheck, and build before saying a phase is done.
- Commit after each working step with a clear message.
- The app must work on mobile browsers, with clear handling of mic permission and failed uploads.

## Where the code lives

- `auth.config.ts` — edge-safe Auth.js config (providers, `/login` page, the `authorized` gate). No database imports; `proxy.ts` uses this.
- `auth.ts` — full Auth.js config: the `ALLOWED_EMAILS` check, and the `jwt`/`session` callbacks that mirror the account into `users` and carry its id.
- `proxy.ts` — route protection (Next 16's rename of `middleware.ts`). Everything is private except `/login` and `/api/auth/*`.
- `lib/db/index.ts` — `getDb()`, a lazily created Drizzle client over Neon HTTP. Lazy so `next build` works without `DATABASE_URL`.
- `lib/db/schema.ts` — the six tables. `lib/db/users.ts` — `ensureUser()`, the Auth.js-to-Postgres bridge.
- `lib/schemas.ts` — zod schemas plus the plainer JSON Schemas sent to Gemini. The two are deliberately different: Gemini ignores constraints like `minLength`, so zod is the real gate.
- `lib/gemini/` — `index.ts` is the single entry point (both calls, the retry, the key); `prompts.ts` holds the examiner and question prompts.
- `lib/audio.ts` — recording limits and the browser-MIME to Gemini-MIME mapping, shared by the recorder and `/api/evaluate`.
- `lib/rate-limit.ts` — the daily cap, counted from `api_requests` per UTC day.
- `lib/db/queries.ts` — every read and write for sessions, answers, feedback and mistakes, including the atomic `db.batch` save.
- `components/` — `Recorder.tsx` (microphone and clocks), `PracticeSession.tsx` (the per-part flow), `ResultCard.tsx` (shared by the live result and history).

## Current phase

Phase 2: Core speaking loop — code complete; the Gemini calls are confirmed working against the live API. Remaining before phase 2 can be called done: sign in on the deployed app and record one answer through the browser.

**Model choice.** `GEMINI_MODEL` is `gemini-3.5-flash-lite`, not because it is the better examiner but because `gemini-4-hydrogen` allows only 5 requests per minute on the free tier — one practice session exceeds that — and returns 503 under load. Revisit this in phase 3: scoring quality is exactly what phase 3 measures, and a weaker model is the likeliest source of inflated bands.

Phase 3 is next and is where the examiner prompt gets its real work: expand the band descriptors in `lib/gemini/prompts.ts`, then check output against real answers for inflation. The prompt there is marked as a first draft on purpose. Do not start phase 4 (charts, vocabulary notebook) before that.
