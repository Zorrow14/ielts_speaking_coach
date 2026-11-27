# Rollback: guest mode, 27 November 2026

Guest mode was built on top of phase 5, deployed, and rolled back the same day.
This file records what happened and what to do differently, so a retry does not
repeat it.

**Nothing was lost.** The work is on branch `backup/guest-attempt-20261127`,
tagged `guest-attempt-20261127`, both pointing at `db189b1`.

---

## What went wrong

The deployed app showed:

> Could not reach the server. Check your connection.

with `POST /api/question` returning **500** in the browser console.

The Vercel runtime logs gave the real cause:

```
NeonDbError: relation "rate_buckets" does not exist   (code 42P01)
```

### The cause was not guest mode

This is the single most important thing on this page.

The Vercel production deployment reads the Neon **`production`** branch, and that
branch still had only migrations `0000` and `0001` applied. Meanwhile the
deployed code was from `db189b1`, which expects `0006`. Four separate routes were
failing, and only one of them was guest:

| Route | Failing on | Introduced by | Phase |
|---|---|---|---|
| `/api/question` | `relation "rate_buckets" does not exist` | `0004` | 5 |
| `/progress` | `column f.prompt_version does not exist` | `0002` | 3 |
| `/vocab` | `column "next_review" does not exist` | `0003` | 4 |
| `/api/guest/question` | `relation "guest_usage" does not exist` | `0006` | guest |

Three of the four are phases 3 to 5. Removing guest mode fixes the fourth row of
that table and nothing else — **the first three will still fail in production
until `0002`–`0005` are applied there.**

### The underlying mistake

Migrations were applied to the `dev` branch and treated as done. The deployment
reads `production`, which was never migrated past `0001`. Code and schema drifted
apart across five migrations before anything was tried end to end against the
deployed app, so when it broke, five changes were suspect at once and the newest
one — guest mode — took the blame.

`/api/question` made this harder to read than it needed to be:
`consumeDailyAllowance()` is called *before* the `try` block, so a database
failure there escapes the handler and becomes a bare 500 with no structured log
line, instead of the clear error the route was designed to return.

---

## What was removed

### Code — revert commit `3a83f6e` on `rollback/pre-guest`

Reverts `380a1f6`, `1951d29` and `db189b1`. The resulting tree is byte-identical
to `44713c3`, verified with `git diff --stat 44713c3` returning empty.

Deleted outright:

- `app/api/guest/{start,question,evaluate}/route.ts`
- `app/guest/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`
- `lib/guest/{config,token,guard,usage}.ts`
- `components/GuestSession.tsx`, `components/GuestBotId.tsx`
- `drizzle/0006_friendly_post.sql` and its snapshot
- `tests/unit/guest-{config,token}.test.ts`,
  `tests/structure/guest-isolation.test.ts`, `tests/db/guest-usage.test.ts`

Reverted in place: `lib/db/schema.ts` (the `guestUsage` table),
`components/Recorder.tsx` (the `hardLimitMs` prop), `components/Nav.tsx`,
`auth.config.ts`, `next.config.ts` (the BotID wrapper), `lib/schemas.ts`,
`app/globals.css`, `app/login/page.tsx`,
`tests/structure/security.test.ts`, `CLAUDE.md`, `DEPLOY.md`, `.env.example`.

**Dependency removed:** `botid@1.5.13`, the only package guest mode added.
Restored by `npm ci` from the reverted lockfile.

### Database — `dev` branch only

Production was never touched. `0006` had never been applied there, and there was
no `guest_usage` table on it.

On `dev`, two statements:

```sql
DROP TABLE "guest_usage";

DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = 1795786084376;
```

The table held **0 rows** — the counter never successfully incremented, so no
data was discarded. Its primary key and `guest_usage_day_idx` were dropped with
it. There was no cron job to remove: the old-row sweep ran lazily inside
`lib/guest/usage.ts`, which the revert deleted.

Owner row counts, before and after, unchanged:

| Table | Before | After |
|---|---|---|
| `sessions` | 1 | 1 |
| `answers` | 1 | 1 |
| `feedback` | 1 | 1 |
| `mistakes` | 1 | 1 |
| `vocab_notebook` | 0 | 0 |
| `users` | 1 | 1 |

Applied migrations went from 7 to 6, matching the 6 files now in `drizzle/` and
the 6 entries in the journal. `npm run db:migrate` against `dev` is now a no-op.

### Config

No `GUEST_*` or `GEMINI_PAID_TIER` variable existed in `.env.local` or in Vercel,
so there was nothing to remove. `.env.example` is back to its nine pre-guest
names.

---

## What to do differently on a retry

1. **Migrate `production` first, then deploy.** This is the whole lesson. Apply
   `0002`–`0005` to the `production` branch and confirm the app works before
   adding anything new. `DEPLOY.md` section 4 has the procedure; the short form
   is to set `DATABASE_URL` to the production string in a throwaway shell and run
   `npx drizzle-kit migrate`.

2. **Make a migration part of deploying, not a thing remembered afterwards.**
   Every future schema change should be applied to `production` in the same
   session as the deploy that needs it, or the two will drift again.

3. **Fix `/api/question` so a database failure is legible.** Move
   `consumeDailyAllowance()` inside the `try`, or wrap it, so the route returns
   its own classified error and writes a structured log line instead of a bare
   500. The same pattern is worth checking on the other routes.

4. **Smoke-test the deployed app after each phase**, not after five. One recorded
   answer against production would have caught this at phase 3.

5. **Then restore guest mode** with `git cherry-pick 380a1f6 1951d29 db189b1`, or
   `git merge backup/guest-attempt-20261127`. The code itself was not at fault and
   needs no rework — its migration `0006` is additive and safe on populated
   tables. Re-add `botid` with `npm install botid@1.5.13`.

6. **Rotate the Neon password first if it has not been done.** A production
   connection string was pasted into a chat transcript on 27 Nov 2026. Reset the
   `neondb_owner` password on both the `production` and `dev` branches and update
   Vercel and `.env.local`.

---

## Still open after this rollback

- **Production is still broken.** It has `0000`–`0001` only and is serving code
  that needs `0005`. `/api/question`, `/progress` and `/vocab` will keep failing
  until the migration runs. The rollback did not address this and was never going
  to.
- The Vercel production deployment is still `db189b1`, the guest-mode build. See
  the deployment section below.
- Neon branch `before-0002-0006` exists as a restore point taken before the
  attempted production migration. Delete it once production is healthy.
- Neon branch `sqlcheck-phase4` is a leftover scratch branch from phase 4
  verification. Safe to delete.
- The `dev` branch has a TTL and expires 2026-12-26.
