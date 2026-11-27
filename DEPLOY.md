# Deploying IELTS Speaking Coach

Single-user app on Vercel, with Neon serverless Postgres and Gemini. Nothing
here needs a CI pipeline: a push to `main` deploys, and the only manual steps
are environment variables and migrations.

---

## 1. Environment variables

Set these in **Vercel → Settings → Environment Variables**, for both the
**Production** and **Preview** targets. Names only below; never paste a value
into a chat, a commit, an issue, or a log.

| Variable | What it is | Notes |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | Point Production at the `production` branch and Preview at `dev`, so a preview deploy cannot write to real data. |
| `AUTH_SECRET` | Auth.js session signing key | Generate with `npx auth secret`. Changing it signs everyone out. |
| `AUTH_GITHUB_ID` | GitHub OAuth app client id | One OAuth app per domain; see section 3. |
| `AUTH_GITHUB_SECRET` | GitHub OAuth app client secret | **Must be set on Preview too**, or preview logins fail. |
| `ALLOWED_EMAILS` | Comma-separated sign-in allowlist | **Fails closed**: empty or unset means nobody can sign in. This is the single-user lock. |
| `GEMINI_API_KEY` | Google AI Studio key | Server only. Never referenced in client code, and a runtime guard throws if the module is ever bundled for the browser. |
| `GEMINI_MODEL` | Model id | Currently `gemini-3.5-flash-lite`. See CLAUDE.md for why, and `npm run calibrate` before changing it. |
| `DAILY_REQUEST_CAP` | Optional, default 40 | Combined daily cap across `/api/question`, `/api/evaluate` and `/api/model-answer`, per UTC day. |
| `BURST_REQUEST_CAP` | Optional, default 6 | Requests allowed per clock minute. Stops a stuck retry burning the day's allowance. |

`AUTH_URL` is only needed if Vercel's inferred URL is wrong; normally leave it
unset.

### Guest mode variables

Guest mode is off until `GUEST_MODE_ENABLED` is exactly `true`. The full list
with defaults is in `.env.example`; these are the ones worth thinking about
before you flip it:

| Variable | Default | Why you would change it |
|---|---|---|
| `GUEST_MODE_ENABLED` | `false` | The kill switch. Fails closed. The pages that read it render per request, so flipping it in Vercel takes effect on the next request with no redeploy. |
| `GEMINI_PAID_TIER` | `false` | **Changes what the privacy page tells guests.** Left false, it states that Google may use submitted audio to improve their products and that human reviewers may see it — true of the free tier. Set it only once billing is actually on, in the same change. |
| `GUEST_GLOBAL_EVALUATIONS` | `100` | The budget that protects the bill, across all guests per UTC day. Worth lowering the first time you share the link. |
| `GUEST_EVALUATIONS_PER_TOKEN` | `3` | How much one visitor gets. |
| `GUEST_EVALUATIONS_PER_IP` | `5` | Stops clearing cookies from resetting the allowance. |

Vercel BotID needs no environment variable. BotID Basic is free on all plans;
Deep Analysis, the ML layer for human-mimicking automation, requires Pro and is
not available on Hobby, so on Hobby the check is heuristic only.

**Do not create any `NEXT_PUBLIC_*` variable.** Anything with that prefix is
inlined into the browser bundle. A test in `tests/structure/security.test.ts`
fails if one appears.

---

## 2. Neon: production vs dev

Two branches, deliberately:

| Branch | Used by | Why |
|---|---|---|
| `production` | The Vercel Production deployment | Holds your real practice history. |
| `dev` | Local development, and Vercel Preview | Throwaway. `drizzle.config.ts` reads `.env.local`, so `npm run db:migrate` targets this by default. |

Checks worth making once:

- **Remove any TTL on `dev`.** Neon creates branches with a 30-day expiry by
  default, and an expired branch is deleted along with its data.
- **Confirm which branch a connection string points at** by its host: each
  branch has its own `ep-...` endpoint. Reveal `DATABASE_URL` in Vercel and
  compare the hostname against Neon → Branches → Connect.
- **Never point Production at `dev`.** Local testing would then write into the
  same tables your progress charts read.

---

## 3. GitHub OAuth app

One app per domain. Callback URL must be exactly:

```
https://<your-vercel-domain>/api/auth/callback/github
```

A mismatch shows up as a sign-in that bounces straight back to `/login` with
no error — the most common deployment failure in this app.

For local work, a second OAuth app with `http://localhost:3000/api/auth/callback/github`.

---

## 4. Migration procedure

Migrations are plain SQL in `drizzle/`, applied in order by `drizzle-kit`.

```bash
# 1. Confirm what is pending and read the SQL first.
cat drizzle/00*.sql

# 2. Apply to dev and exercise the app against it.
npm run db:migrate          # uses DATABASE_URL from .env.local

# 3. Snapshot production before touching it (see section 7).

# 4. Apply to production by pointing DATABASE_URL at it for one command.
#    Do this in a shell, not by editing .env.local, so dev stays the default.
DATABASE_URL="<production pooled string>" npx drizzle-kit migrate
```

**Read every migration before applying it.** Two in this repo are not safe on
populated tables:

- **`0002`** drops and recreates the `mistake_category` enum, because phase 3
  replaced its values wholesale, and adds three `NOT NULL` columns with no
  default. It only succeeds while `feedback` and `mistakes` are empty.
- Everything else (`0003`, `0004`, `0005`) is additive and safe on live data.

`drizzle-kit` decides what to re-run by comparing the journal's `created_at`
against each migration folder's timestamp, not by hash. It also normalises CRLF
to LF before hashing, so a hash computed from a file as Windows checked it out
will not match the stored one — that is expected, not corruption.

---

## 5. Post-deploy smoke test

In order. Stop at the first failure; each one has a distinct cause.

| # | Check | Pass looks like | If it fails |
|---|---|---|---|
| 1 | `curl -i https://<domain>/api/health` | `200` with `{"status":"ok","database":"reachable"}` | `503` means `DATABASE_URL` is wrong or the branch is suspended. A redirect to `vercel.com/sso-api` means Deployment Protection is on. |
| 2 | Security headers on the same response | `content-security-policy`, `x-frame-options`, `strict-transport-security` present; no `x-powered-by` | `next.config.ts` did not deploy; check the build log. |
| 3 | Open `/` signed out | Redirected to `/login` | Route protection is broken; check `proxy.ts`. |
| 4 | `curl -i https://<domain>/api/progress` with no session | `401` and a JSON body, **not** an HTML login page | `authorized()` in `auth.config.ts`. |
| 5 | Sign in with your GitHub account | Lands on `/` showing your email | A bounce back to `/login` is the OAuth callback URL (section 3); "access denied" is `ALLOWED_EMAILS`. |
| 6 | Sign in with a different GitHub account | Refused | `ALLOWED_EMAILS` contains more than your address. |
| 7 | Record one Part 1 answer | A result with evidence quotes under each criterion | See Vercel → Logs and search the `requestId` from the error body. |
| 8 | `/progress`, `/mistakes`, `/vocab`, `/weekly` | All load, empty states where there is no data | A 500 here is usually an unapplied migration. |
| 9 | Save a phrase from the result, reload `/vocab` | The phrase is there | Nothing is in `localStorage`; if it vanishes, the POST failed. |
| 10 | With `GUEST_MODE_ENABLED=true`, open `/guest` signed out | Consent checkbox, then a question once ticked | A 404 means the kill switch is still off. A 503 means BotID could not run — guest mode fails closed on purpose. |
| 11 | After one guest answer, inspect the database | Only `guest_usage` gained rows | A row in `answers`, `feedback`, `mistakes` or `vocab_notebook` is a bug, not a setting. The SQL is in the guest section below. |

### Checking guest mode stored nothing

```sql
-- Must all be zero after guest use (assuming you have not practised as owner).
select
  (select count(*) from answers)        as answers,
  (select count(*) from feedback)       as feedback,
  (select count(*) from mistakes)       as mistakes,
  (select count(*) from sessions)       as sessions,
  (select count(*) from vocab_notebook) as vocab;

-- The only thing guest traffic writes. No IP, no text, no content.
select subject, day, endpoint, count from guest_usage order by day desc;
```

---

## 6. Rollback

**Code.** Vercel → Deployments → pick the last good one → **Promote to
Production**. This is instant and does not rebuild. Do this first: it restores
service while you work out what broke.

Do not roll code back past a migration that has already been applied, unless
that migration was additive. Old code against a newer schema is usually fine
(extra columns are ignored); new code against an older schema is not.

**A bad migration.** Neon branching makes this recoverable without a dump:

1. Neon → Branches → `production` → **Restore** → choose a timestamp just
   before the migration ran. Neon keeps a history window (7 days on the free
   plan) and restores by creating a branch at that point in time.
2. Verify the restored data, then make it the branch Vercel uses.
3. Fix the migration, test it on `dev`, and apply it again.

**Never edit a migration that has already been applied.** Write a new one that
corrects it; otherwise `dev` and `production` silently diverge.

---

## 7. Backup and recovery

There is no separate backup system, and for this app there does not need to be
— Neon's own history is the backup, as long as you use it deliberately.

**Before any risky change** (a migration on production, a bulk delete, a schema
experiment):

```
Neon → Branches → production → Create branch from this branch
```

Name it something like `before-0006`. It is a copy-on-write snapshot: instant,
and it costs almost nothing until the two diverge. If the change goes wrong,
you still have the data as it was. Delete the branch once you are confident.

Neon also offers scheduled **snapshots**; on the free plan the point-in-time
history window is **7 days**, which is the real limit on how far back you can
recover. If you ever want longer than that, the cheap answer is a periodic
`pg_dump` to somewhere outside Neon, not a bigger plan.

**What is not backed up, by design:** audio. It exists only in browser memory
and in one function's scope, and is never written to disk or to the database.
A lost recording cannot be recovered — it has to be re-recorded. Transcripts
and feedback are in Postgres and are covered by the above.

**To recover a single deleted answer** rather than the whole database: create a
branch at a timestamp before the deletion, read the row out of it with
`npm run db:studio` pointed at that branch, and re-insert it. Do not restore
the whole production branch for one row.

---

## 8. Plan limits this assumes

- **`maxDuration = 60`** on `/api/evaluate` is the ceiling on Vercel's **Hobby**
  plan. Pro allows up to 300. The Gemini timeout is 55s so that a slow model
  produces the app's own clear error rather than Vercel's opaque 504 — if you
  move to Pro and raise `maxDuration`, raise `GEMINI_TIMEOUT_MS` in
  `lib/gemini/index.ts` with it, never one alone.
- **~4.5 MB request body limit** on Vercel. `MAX_AUDIO_BYTES` is 4 MB and the
  recorder hard-stops at three minutes, which keeps Opus well under it.
- **Gemini free tier** rate limits are per model and low. `gemini-3.5-flash-lite`
  copes with a practice session; `gemini-4-hydrogen` allows only 5 requests per
  minute, which one session exceeds.
- **Neon free tier**: one project, a 7-day history window, and branches that
  expire after 30 days unless you clear the TTL.
