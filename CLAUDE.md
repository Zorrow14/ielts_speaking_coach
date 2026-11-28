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
- Phase 5: an atomic daily cap, a per-minute burst cap, Gemini timeouts and classified failures, idempotent evaluation, structured request logging, security headers, error boundaries, and `DEPLOY.md`.
- Post-incident hardening (28 Nov): `lib/db-guard.ts` so a database failure is a classified 503 rather than a bare 500, `npm run db:check`, and a `/api/health` that reports schema drift. 113 tests.

Lint, typecheck, build and tests all pass. What has been checked against live services:

- `.env.local` exists with all eight values filled in.
- **All six migrations (`0000`–`0005`) are applied to both Neon branches, `dev` and `production`.** Confirmed by querying `drizzle.__drizzle_migrations` on each, and on production by checking that `rate_buckets`, `feedback.prompt_version`, `vocab_notebook.next_review`, `answers.client_token`, `mistakes_user_pair_folded_idx` and the ten-value `mistake_category` enum all exist.
- The Gemini `interactions` call has been exercised live for both shapes — a Part 1 question, and an evaluation with inline audio — and returns schema-valid JSON.
- The app is deployed on Vercel with all seven environment variables set, and `https://ieltsspeakingcoach.vercel.app/api/health` returns 200.
- The calibration harness has run against the real model: 36 of 36 calls succeeded, band ordering holds, run-to-run spread is 0 or 0.5.

Still unverified end to end: **GitHub sign-in against the deployed app, and a full recorded answer through a browser.** Nothing has been tried on a phone. Until one real answer has been recorded, marked and saved in production, the core loop is unproven in production — every table there is still empty except `users`.

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
npm run db:check     # are the DATABASE_URL target's migrations in step with drizzle/?
npm run calibrate    # run the fixture transcripts against the real model
npm run test         # node:test suite (unit, structural, and DB when DATABASE_URL is set)
```

The quality gate before calling a phase done is `npm run lint && npm run typecheck && npm run build && npm run test`.

**Before any deploy, also run `npm run db:check` against production.** It prints the migrations the target has applied against the journal in `drizzle/` and exits 1 when the database is behind, which is the exact failure that took the app down on 27 Nov. Names and counts only; it never prints a connection string. It runs on Node's native TypeScript support (22.18+), so there is no build step and no new dependency — that is why `allowImportingTsExtensions` is on in the root tsconfig and explicitly off in the two configs that emit.

`npm run test` uses Node's built-in `node:test` runner — **no test-runner dependency**. It compiles with `tsconfig.tests.json` into a gitignored `.testbuild/`, the same trick the calibration harness uses. The database-backed tests (user isolation, the daily-cap race, idempotency) **skip with a reason** when `DATABASE_URL` is unset, so point it at a disposable branch to run them; they insert and then delete throwaway users, so never aim them at production.

**All six migrations (`0000`–`0005`) are applied to both `dev` and `production`** as of 27 Nov 2026. `npm run db:check` is how you confirm that rather than trusting this paragraph — it reads the target database and exits non-zero if it is behind.

`0003`, `0004` and `0005` are additive and safe on populated tables. `0002` is not — see below. It ran while `feedback` and `mistakes` were empty on both branches, which is the only window in which it could have succeeded. Full procedure, including how to apply to production and how to roll a bad migration back, is in `DEPLOY.md`.

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
- `lib/db-guard.ts` — **the seam that makes a database failure legible.** `dbCall(step, fn)` labels a call; `DatabaseError` digs the SQLSTATE out of drizzle's wrapper; `databaseFailure(log, error)` turns it into a classified 503. The five codes meaning the schema is behind the code get `errorKind: "schema_behind"` and a message saying retrying will not help.
- `lib/schema-state.ts` — compares applied migrations against the journal. Pure: the health route feeds it the journal by import, `scripts/db-check.mts` by `fs`.
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
- `scripts/db-check.mts` — `npm run db:check`. Plain Node, no build step.
- `tests/` — `unit/` pins the scoring arithmetic, guardrails, zod rejections, the database-failure path and the drift comparison; `structure/` reads the source and asserts codebase-wide properties (every route authenticated, every query scoped by user, no secret in a client component); `db/` covers isolation, the cap race and idempotency against a real database.
- `DEPLOY.md` — environment variables, branch setup, migration procedure, smoke test, rollback, and the backup/recovery notes.
- `CALIBRATION_REVIEW.md` — the two disputed fixtures laid out with transcripts, runs and evidence quotes, for a human to settle. Neither has been relabelled.
- `tests/calibration/` — `fixtures.ts` holds hand-written transcripts at known bands, including three in the user's own error profile; `run.ts` scores each three times and reports spread, ordering and inflation. Not part of the app.

## Design system

Direction A, "exam room": quiet, paper-like, the question dominant. The home page alone borrows some warmth (greeting, streak, one focus); practice and results stay exam-quiet, because every score is an estimate and a celebratory UI would oversell it.

**Where things live**

- `app/globals.css` is only an entry point. It imports, in order: `styles/layers.css` (the cascade order, which MUST be imported first or the bundler emits it last and order silently falls back to import order), `tokens.css`, `base.css`, `components.css`, `shell.css`, `pages.css`, `home.css`.
- `app/styles/tokens.css` is **the only file allowed raw colour values**. Colour, type scale, spacing, radius, shadow, motion durations and layout sizes are all custom properties here.
- Dark mode is its own set of steps, defined twice in `tokens.css` (manual `[data-theme="dark"]`, and inside `prefers-color-scheme`). The two blocks must stay identical; a test enforces it.
- `components/Icon.tsx` is the icon set, drawn for this project. No icon library.

**Theme**

System by default; a System / Light / Dark switch (`components/ThemeToggle.tsx`) in the sidebar and the phone "More" sheet. The choice is a first-party `theme` cookie holding one of two words, read in `app/layout.tsx` and rendered into `<html data-theme>`, so the first paint is right with **no inline script**. It is not app data, so it does not conflict with the no-localStorage rule, and it needed no schema change. The cost, accepted: every route renders dynamically. `lib/theme.ts` holds the cookie definition and `THEME_COLORS` (the browser toolbar colour, which must equal `--color-bg`). Chart.js cannot read CSS, so the charts use `lib/use-resolved-theme.ts`, which follows the manual choice and the system together.

**Adding a component**

1. Use existing tokens. If a value genuinely does not exist, add a token to `tokens.css` - with a dark value, and its contrast checked with a calculator, not by eye.
2. Put the CSS in the right layer: a reusable primitive in `components.css`, page-specific styles in `pages.css`. Every rule must sit inside an `@layer` block; an unlayered rule beats the whole system regardless of specificity.
3. Name it BEM-style: `.block`, `.block__part`, `.block--variant`. Existing class names (`.button--quiet`, `.card--link`, `.chip`, `.tag`) are the public API - keep them working.
4. Run `npm run test`. `tests/structure/design-tokens.test.ts` fails on an undefined `var()`, a raw colour outside `tokens.css`, a rule outside a layer, an invisible control character, or the two dark blocks drifting apart.

**Primitives available**: buttons (`.button`, `--quiet`/`--secondary`, `--ghost`, `--danger`, `--tiny`, `--large`, `--block`, `.icon-button`), `.card` (`--link`, `--priority`, `--temp`), `.panel`, `.field` and `.input`, `.chip` and `.filters`, `.tabs`/`.tab`, `.segmented`, `.badge` (`--accent`/`--success`/`--warning`/`--danger`) and `.tag`, `.estimate-note`, `.alert` (`--soft`), `.notice` (`--success`), `.toast-region`/`.toast`, `.dialog` (`--sheet` becomes a bottom sheet on phones), `.empty`, `.skeleton` (`--text`, `--title`, `--block`), `.data-table`, `.muted`, `.visually-hidden`, `.eyebrow`, `.select` (a select with a token-coloured chevron), `.search-field`, and `.filter-panel` with `__head`, `__grid`, `__group`, `__actions`, `.date-range` and removable `.chip--removable` chips.

**Filters are plain GET forms.** `components/SegmentedField.tsx` renders a segmented radio group with no client JavaScript, so filtering works with scripts off and every filtered view is a URL. Each applied filter is a chip linking to the same view without it. Controls adapt with container queries (`.segmented`, `.filter-panel__group` are size containers), so a control follows the space it has, not the screen width - which is what lets the same theme switch stack its icons in the narrow sidebar and sit inline in the phone sheet.

**Motion rules**

- Durations come from tokens (`--duration-fast` 120ms, `--duration-base` 200ms, `--duration-slow` 320ms) with `--ease-standard`. No overshoot anywhere.
- Timers move linearly, and are driven by the existing `Date.now()` clock, never a separate CSS animation that could drift from it.
- Bands appear; they do not count up. A number ticking from 0.0 to 6.5 implies precision an estimate does not have.
- `prefers-reduced-motion`: the duration tokens collapse to 0, and `base.css` stops any animation that bypasses a token. Nothing moves for someone who asked for it not to.

**Accessibility rules**

- Text at least 4.5:1 (body text is 13:1+), control borders at least 3:1 against every surface (`--color-border-strong`; `--color-border` is decorative only).
- One focus ring everywhere (`:focus-visible`, 3px accent), never removed.
- Every interactive target is at least 44px (`--tap-min`).
- State is never carried by colour alone: the active nav item is colour plus a bar plus weight; deltas say "higher"/"lower".
- Use native elements where they exist: `<dialog>` with `showModal()` for sheets (focus trap, Escape, focus return for free), real radio inputs for the theme switch.
- Forced-colors mode keeps the borders that colour was drawing.

**Navigation**: a sidebar when the window is at least 48rem wide **and** 35rem (560px) tall; the bottom tab bar (Home, Practise, History, Progress, More) everywhere else, landscape phones included. **The sidebar never scrolls** (`overflow: hidden`): it tightens its spacing below 46rem tall and drops the section label below 38rem, and the height condition hands short windows to the bottom bar rather than clip sign-out. 560px is the shortest window measured to fit. Every media query that chooses between the two layouts must use the same pair of conditions - see the comment at the top of `app/styles/shell.css`. Both live in one `<nav>` landmark; CSS shows exactly one, so the hidden one is out of the accessibility tree. Safe areas are handled with `viewport-fit=cover` and `env(safe-area-inset-*)`.

**The practice loop** (`app/styles/practice.css`, Stage 2):

- **Level meter** (`lib/use-level-meter.ts`) is a progressive enhancement beside MediaRecorder, never in front of it. Its AudioContext is created and resumed **synchronously inside the "Start recording" tap, before the first await** (iOS Safari only runs a context started in a user gesture); it is attached only **after** `recorder.start()`; the analyser is never connected to `destination`, so nothing plays; it reads loudness into the DOM per frame and stores and sends nothing; every Web Audio call is guarded, and if any fails - or the context stays suspended - the plain pulsing dot is shown instead. `tests/structure/result-labels.test.ts` pins all of this by reading the source.
- **Preparation ring** (`components/PrepRing.tsx`) is drawn from the countdown PracticeSession already keeps from `Date.now()`, never its own CSS animation, so the ring and the number cannot disagree.
- **The recording dock** is sticky above the bottom bar on phones and becomes a compact bar while recording, so the Part 2 cue card stays readable.
- **Results** (`components/ResultCard.tsx`) stays hook-free because the history pages render it on the server; evidence expands with native `<details>` (the `.disclosure` primitive). Every score - overall, each band, the pronunciation indicator - carries the full "AI estimate, not an official IELTS band" label, and Pronunciation is its own dashed box with a confidence badge and **no band bar**. The same test enforces both.
- **Runtime custom properties** set from TSX or JS (`--offset`, `--level`, `--progress`, `--at`, `--fill`, `--i`) are declared with a default on the element that uses them. An inline style on that element still wins, and the design-token test can then tell a deliberate runtime value from a typo.
- **Screen readers**: one `role="status"` chip announces each stage (Ready, Recording, Uploading, Marking, Marked); the preparation countdown speaks at 60/45/30/15/5 seconds rather than every second.

**Fonts**: Source Serif 4 (titles and question text, one static 600 weight), Geist (body), Geist Mono (clocks and bands, tabular figures). Self-hosted by `next/font` at build time, so `font-src 'self'` is enough.

## Current phase

Phases 1 to 5 are built, and production finally runs the schema the code expects. The remaining work is verification, not construction.

**What is actually true right now:**

- All six migrations are applied to `dev` and `production`. `npm run db:check` confirms it.
- `https://ieltsspeakingcoach.vercel.app/api/health` returns 200.
- Lint, typecheck, build and 113 tests pass.
- Production holds **one `users` row and nothing else**. No session, answer, feedback or mistake has ever been written there.

**What still has not been done, and matters most:** record one real answer through the deployed app on a phone. Sign in with GitHub, answer a Part 1 question, and confirm the result saves and appears in history and progress. Everything else is inference until that happens.

### What the 27 November outage changed

Migrations were applied to `dev`; the deployment read `production`; nothing compared them. Code and schema drifted across five migrations and the first signal was a 500 in a browser console. Three things came out of it:

- **No route awaits anything before it can handle a failure.** `/api/question` called `consumeDailyAllowance()` above its try block, so the throw escaped the handler entirely. A structural test now enforces the rule for every route, including ones not written yet.
- **A database failure is never a bare 500.** `lib/db-guard.ts` classifies it, and a missing table or column says so explicitly rather than looking like a transient fault.
- **Drift is checkable.** `npm run db:check` before every deploy, and `/api/health` returns `schema_behind` with the missing migration names instead of cheerfully saying "ok" while every route 500s.

Known limitations, recorded rather than hidden:

- `script-src 'unsafe-inline'` remains in the CSP (see `next.config.ts`).
- Audio duration is client-reported and only range-checked; the byte limit is the real server-side guard, because the server cannot measure duration without decoding.
- The notebook search uses `ILIKE '%...%'`, which no btree index can serve. Fine at this size; `pg_trgm` would be the fix if it ever is not.
- Vercel's `DATABASE_URL` is set for **both** Production and Preview, and both point at the `production` branch. A preview deploy can therefore write to real data. `DEPLOY.md` section 2 says they should be split.
- The `dev` branch has a TTL and expires **2026-12-26**. An expired Neon branch is deleted with its data.
- Two calibration fixtures still score above their labels; see `CALIBRATION_REVIEW.md`.
- Nothing has been exercised on a real phone yet.

**Model choice.** `GEMINI_MODEL` is `gemini-3.5-flash-lite`, chosen in phase 2 because `gemini-4-hydrogen` allows only 5 requests per minute on the free tier. `npm run calibrate` is the tool for revisiting it.

The plan's five phases are all built. Anything further is new scope: the Gemini Live API, a second user, or retrying guest mode from the backup branch.

## Rolled back attempts

**Guest mode — attempted and rolled back, 27 Nov 2026.**

Guest mode (public `/api/guest/*` routes, a signed guest token, a Vercel BotID check, anonymous `guest_usage` counters, privacy and terms pages, and a guest UI) was built on top of phase 5 and then reverted in full. Phases 1 to 5 are untouched.

- **The work is kept**, not lost: branch `backup/guest-attempt-20261127`, tag `guest-attempt-20261127`, both at `db189b1`. Nothing was force-pushed and no history was rewritten; the rollback is a revert commit on top.
- **Why it was rolled back:** the deployed app started returning `500` on `/api/question` ("Could not reach the server. Check your connection."). The cause was **not** guest mode — the Vercel production deployment was pointed at the Neon `production` branch, which still had only migrations `0000`–`0001`, so `rate_buckets` (`0004`), `feedback.prompt_version` (`0002`) and `vocab_notebook.next_review` (`0003`) were all missing. Guest mode's own `0006` was one symptom among four, not the disease.
- **Before retrying**, note that `0002`–`0005` have since been applied to `production` (27 Nov), so the original blocker is gone. Run `npm run db:check` against production first anyway, and apply guest mode's own `0006` before deploying it.

See `ROLLBACK_NOTES.md` for the full account and the retry checklist.
