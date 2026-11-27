# IELTS Speaking Coach

A single-user web app for practising IELTS Speaking. You record a spoken answer
to a generated question, and get back a transcript, criterion-by-criterion band
estimates with the evidence behind each one, specific corrected mistakes, and
three things to work on next.

> **These are AI estimates, not IELTS bands.** This project is not affiliated
> with or endorsed by IELTS, the British Council, IDP or Cambridge Assessment
> English. Every score in the UI is labelled an estimate, and Pronunciation is
> shown as an indicator only, never as a band — judging pronunciation from a
> single phone recording is not something this can do honestly.

Built for one person's own practice. There is no sign-up: access is an email
allowlist, and the app is meant to be deployed to your own Vercel and Neon
accounts rather than used as a service.

---

## What it does

**Practice.** Parts 1, 2 and 3. Questions are generated for each attempt rather
than drawn from a bank — Part 1 gets a familiar personal question, Part 2 a
four-bullet "Describe…" cue card, and Part 3 a follow-up written against the
transcript of what you just said. The topics of your last 12 sessions are passed
in as a list to avoid, so you are not asked about your hometown every day.

**Marking.** One Gemini call per answer takes the audio and returns a transcript
plus the four criteria — Fluency and Coherence, Lexical Resource, Grammatical
Range and Accuracy, Pronunciation. Every criterion has to quote the transcript
to justify its band; a score with no evidence behind it is rejected before it
reaches you. The overall band is computed in code using the IELTS rounding rule,
not asked of the model.

**Progress.** Score trends with a 5-answer moving average, a practice streak,
repeated mistakes grouped by category and by original→correction pair, a
first-5-vs-last-5 baseline comparison, and a weekly report. All of it is SQL
aggregation over your stored results, with no extra AI call.

**Notebook.** Save a phrase from any result, or add one by hand, and review it on
a 1/3/7/14-day ladder.

## Design constraints

Four rules shaped most of the code:

- **Audio is never stored.** `MediaRecorder` captures it, the route forwards it
  to Gemini, and it is discarded when the response comes back. It is never
  written to disk, to the database or to a log. A lost recording has to be
  re-recorded — that is the trade.
- **Gemini is only ever called from the server.** The API key lives in a server
  environment variable, and a runtime guard throws if the module is ever bundled
  for the browser.
- **Postgres is the only store.** No `localStorage`, no `sessionStorage`. Every
  table carries a `user_id` and every query filters on it, even with one user —
  so multi-user is a feature, not a migration.
- **Scores start low.** The prompt carries condensed band descriptors and an
  explicit instruction to take the lowest defensible band and never round up,
  because inflation is the failure mode that makes a tool like this useless.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · plain CSS · Auth.js v5 with
GitHub sign-in · Neon serverless Postgres via Drizzle · Gemini · Chart.js ·
deployed on Vercel.

Tests run on Node's built-in `node:test` — no test-runner dependency.

## Running it locally

You will need Node 20.12+, a Neon project and a Google AI Studio key.

```bash
git clone https://github.com/Zorrow14/ielts_speaking_coach.git
cd ielts_speaking_coach
npm install
cp .env.example .env.local   # then fill it in; see the comments in that file
npm run db:migrate           # applies migrations to whatever DATABASE_URL points at
npm run dev
```

`ALLOWED_EMAILS` is the lock, and it **fails closed** — leave it empty and nobody
can sign in, including you. Put your own GitHub account's email in it.

Point `DATABASE_URL` at a Neon **branch**, not your production branch, for local
work. `npm run db:migrate` writes to whatever it finds there.

Microphone access needs a secure context, so recording works on `localhost` and
over HTTPS, but not over plain HTTP on a LAN address.

### Commands

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm run lint` / `npm run typecheck` | eslint / `tsc --noEmit` |
| `npm run test` | the test suite; database tests skip unless `DATABASE_URL` is set |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle |
| `npm run calibrate` | score the fixture transcripts against the real model |

`npm run calibrate` is the tool for checking whether a prompt or model change
moved the scores. It runs hand-written transcripts of known quality three times
each and reports spread, band ordering and inflation. It does not prove the
marking is accurate — nothing here does — but it catches a change that quietly
makes the model generous.

## Documentation

| File | What is in it |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | environment variables, Neon branch setup, the migration procedure, a post-deploy smoke test, rollback and recovery |
| [`CLAUDE.md`](CLAUDE.md) | architecture notes and a map of where each piece of code lives |
| [`IELTS_Speaking_Coach_Project_Plan.md`](IELTS_Speaking_Coach_Project_Plan.md) | the original spec |
| [`ROLLBACK_NOTES.md`](ROLLBACK_NOTES.md) | a guest-mode attempt that was built and reverted, and why |

## Known limitations

- **Pronunciation cannot be scored properly** from compressed phone audio. It is
  reported with a confidence level and excluded from the overall band when the
  model says it could not judge.
- Two calibration fixtures still disagree with the model by a full band. Noted
  rather than tuned away, in `tests/calibration/`.
- Recording is capped at three minutes to stay under Vercel's ~4.5 MB request
  limit. Duration is client-reported; the byte limit is the real server-side
  guard.
- `script-src 'unsafe-inline'` remains in the CSP, because removing it needs
  per-request nonces through middleware.
- Nothing has been exercised on a real phone yet.

## Licence

MIT — see [`LICENSE`](LICENSE).
