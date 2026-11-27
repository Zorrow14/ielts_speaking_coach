# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 1 to 5 are code-complete and committed on `main`, pushed to https://github.com/Zorrow14/ielts_speaking_coach. On top of phase 1 (Next.js 16 App Router, Drizzle schema, Auth.js GitHub sign-in with every route protected) the app now has:

- `lib/gemini/` — the only module that calls Gemini, via the `interactions` API with structured JSON output and `store: false`.
- `POST /api/question` and `POST /api/evaluate`, both authenticated, both counted against a daily cap.
- A `MediaRecorder` recorder with named errors for each failure mode, a two-minute soft warning and a three-minute hard stop.
- Practice flows for Parts 1, 2 and 3, a results screen, and a history list that reopens saved feedback.
- Phase 3: a versioned examiner prompt with evidence quotes per criterion, overall computed in code, and deterministic guardrails.
- Phase 4: progress charts, mistake history, a vocabulary notebook with review mode, and a weekly report — all reading SQL aggregates, none of them making a new Gemini call.
- Phase 5: an atomic daily cap, a per-minute burst cap, Gemini timeouts and classified failures, idempotent evaluation, structured request logging, security headers, error boundaries, a 69-test suite, and `DEPLOY.md`.

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
npm run calibrate    # run the fixture transcripts against the real model
npm run test         # node:test suite (unit, structural, and DB when DATABASE_URL is set)
```

The quality gate before calling a phase done is `npm run lint && npm run typecheck && npm run build && npm run test`.

`npm run test` uses Node's built-in `node:test` runner — **no test-runner dependency**. It compiles with `tsconfig.tests.json` into a gitignored `.testbuild/`, the same trick the calibration harness uses. The database-backed tests (user isolation, the daily-cap race, idempotency) **skip with a reason** when `DATABASE_URL` is unset, so point it at a disposable branch to run them; they insert and then delete throwaway users, so never aim them at production.

Migrations `0000` and `0001` are applied to the `dev` and `production` branches. **`0002` (phase 3), `0003` (phase 4), `0004` and `0005` (phase 5) are generated but NOT applied** — run `npm run db:migrate` against `dev` first.

`0003`, `0004` and `0005` are additive and safe on populated tables. `0002` is not — see below. Full procedure, including how to apply to production and how to roll a bad migration back, is in `DEPLOY.md`.

`0002` recreates the `mistake_category` enum rather than extending it, because phase 3 replaced the values wholesale. That drops and recreates the type, so it only succeeds while `mistakes` is empty; it also adds `prompt_version`, `model` and `pronunciation_confidence` as NOT NULL with no default, which likewise requires an empty `feedback`. Both tables were empty when it was generated. If rows exist by the time it runs, the migration needs a data-mapping step first.

`npm run calibrate` compiles `tests/calibration` with `tsconfig.calibration.json` (plain tsc to CommonJS in `.calibration/`, gitignored) and runs it on Node. This is deliberately not a test runner: the harness is the only thing that needed one, and compiling with the tsc already present avoided a new dependency. It exits non-zero if band ordering breaks or a fixture scores more than 0.5 above its intended band.

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
- `lib/schemas.ts` — zod schemas plus the plainer JSON Schemas sent to Gemini. The two are deliberately different: Gemini ignores constraints like `minLength`, so zod is the real gate. It is also where the evidence rule is enforced: a criterion band with no quote behind it is rejected.
- `lib/prompts/evaluate.ts` — **the examiner prompt**, with `PROMPT_VERSION`. Band descriptors, the start-low strictness rule, the evidence requirement, grammar error counting, per-part expectations, pronunciation confidence, and the model-answer prompt. Bump the version on any change that could move scores.
- `lib/scoring.ts` — the arithmetic and the deterministic guardrails, as named constants at the top of the file. The overall band is computed here, never asked of the model.
- `lib/result-view.ts` — `buildResultView()`, the single shape both the live result and the history page render. Adding a field here makes it appear in both.
- `lib/gemini/` — `index.ts` is the single entry point (every call, the retry, the key, the temperature); `prompts.ts` now holds only the question and cue-card prompts.
- `lib/audio.ts` — recording limits and the browser-MIME to Gemini-MIME mapping, shared by the recorder and `/api/evaluate`.
- `lib/rate-limit.ts` — the daily cap and the per-minute burst cap. **Atomic**: one `insert ... on conflict do update ... where used < cap` against `rate_buckets`, so the conflicting row is locked and the limit re-checked against it. Parallel requests cannot both see the last slot. `api_requests` is now only an audit log, not the enforcement path.
- `lib/log.ts` — structured logging. One JSON line per request with a request id, route, user id, status, duration and error kind, and **never** audio, transcripts, prompts or secrets. `errorResponse()` is how routes reply, so no handler can accidentally return a stack.
- `lib/db/queries.ts` — every read and write for sessions, answers, feedback and mistakes, including the atomic `db.batch` save.
- `lib/db/progress.ts` — **all phase 4 aggregation, in SQL**. Moving averages are window functions, the streak is gaps-and-islands, the week comparisons are filtered aggregates. Nothing is averaged in the browser.
- `lib/db/vocab.ts` — notebook reads and writes plus the 1/3/7/14 day review ladder. Ownership is in the `WHERE` clause of every statement.
- `lib/time.ts` — `APP_TIME_ZONE` (Asia/Kuala_Lumpur), the single constant every day boundary casts through, plus the `Intl` formatters. The UTC request cap deliberately does not use it.
- `lib/focus.ts` — the weekly report's three focus points, as rules over stored data. No Gemini call, and each point carries the number it came from.
- `components/` — `Recorder.tsx` (microphone and clocks), `PracticeSession.tsx` (the per-part flow), `ResultCard.tsx` (shared by the live result and history), `ModelAnswer.tsx` (the on-demand band 7.5 example).
- `components/ProgressCharts.tsx` — Chart.js line and bar charts. Series colours are CVD-validated palette slots, dark mode is a separate set of steps rather than an inversion, and the expandable table is **required** (canvas is invisible to screen readers, and three light-mode steps fall below 3:1 contrast).
- `components/Nav.tsx`, `SaveToNotebook.tsx`, `VocabList.tsx`, `VocabReview.tsx` — the phase 4 client components.
- `next.config.ts` — security headers and the CSP. `script-src` still needs `'unsafe-inline'` for Next's bootstrap scripts; removing it needs per-request nonces through middleware, and that is recorded as an accepted limitation rather than ignored.
- `tests/` — `unit/` pins the scoring arithmetic, guardrails and zod rejections; `structure/` reads the source and asserts codebase-wide properties (every route authenticated, every query scoped by user, no secret in a client component); `db/` covers isolation, the cap race and idempotency against a real database.
- `DEPLOY.md` — environment variables, branch setup, migration procedure, smoke test, rollback, and the backup/recovery notes.
- `tests/calibration/` — `fixtures.ts` holds hand-written transcripts at known bands, including three in the user's own error profile; `run.ts` scores each three times and reports spread, ordering and inflation. Not part of the app.

## Current phase

Phase 5: Hardening — code complete. Lint, typecheck, build and 69 tests pass.

What changed, and why it matters:

- **The daily cap is now exact under concurrency.** Phase 2 counted rows then inserted, which two parallel requests could both pass. It is now a single atomic statement against `rate_buckets`; verified on a scratch branch, where attempts 1–3 against a cap of 3 returned counters and attempts 4–5 returned nothing.
- **Evaluation is idempotent** per recording, keyed on a browser-generated `client_token` with a partial unique index. A retry after a timeout that actually succeeded returns the first result instead of marking and charging twice.
- **Every Gemini call has a 55s timeout**, the SDK's own retry policy is off, and failures are classified (`quota`, `overloaded`, `timeout`, `safety`, `bad_request`, `auth`). A quota error is never retried.
- **A failed upload keeps the audio in memory** so "Try again" re-sends it. Memory only — never a file, never storage.
- **The recorder handles a microphone lost mid-answer and a hidden tab or locked screen**, keeping what was captured and saying what happened.

Known limitations, recorded rather than hidden:

- `script-src 'unsafe-inline'` remains in the CSP (see `next.config.ts`).
- Audio duration is client-reported and only range-checked; the byte limit is the real server-side guard, because the server cannot measure duration without decoding.
- The notebook search uses `ILIKE '%...%'`, which no btree index can serve. Fine at this size; `pg_trgm` would be the fix if it ever is not.
- Nothing has been exercised on a real phone yet.

Remaining before phase 5 can be called done: apply `0002`–`0005` to `dev`, run `npm run test` with `DATABASE_URL` pointed at a disposable branch so the database tests actually execute, and walk the smoke test in `DEPLOY.md` on a phone.

**Model choice.** `GEMINI_MODEL` is `gemini-3.5-flash-lite`, chosen in phase 2 because `gemini-4-hydrogen` allows only 5 requests per minute on the free tier. `npm run calibrate` is the tool for revisiting it.

The plan's five phases are now all built. Anything further is new scope: the Gemini Live API, a second user, or the two calibration fixtures whose intended bands are still disputed (`tests/calibration/README.md`).
