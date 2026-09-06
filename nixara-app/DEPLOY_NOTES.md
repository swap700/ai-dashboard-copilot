# Deploy notes - security fix branch

Two steps are required before this branch works in production. If you skip
them the app still builds and runs, but the free tier turns itself off and
users are asked for their own OpenAI key.

## 1. Run the new schema sections

In Supabase - SQL Editor, run `nixara_supabase_setup.sql`. It is idempotent,
so running the whole file is safe. The new parts are:

- **Section 13** - `nixara_quota` + `consume_quota()`. The shared counter that
  replaces the cookie and the in-memory rate limiter (H3).
- **Section 14** - `log_outcome_record()`, plus dropping the anon INSERT
  policies on `nixara_outcomes` and `nixara_decisions` (H4).
- **Section 15** - the revokes that section 11 intended but did not achieve
  (H5). **This one closes a hole that is open in production right now.**

The file ends with a verification query. Every row must read `f`:

```
                fn                | anon_can_execute | auth_can_execute
----------------------------------+------------------+------------------
 get_decision_by_id(bigint)       | f                | f
 get_outcome_for_decision(bigint) | f                | f
 consume_quota(text,int,int)      | f                | f
 prune_quota(int)                 | f                | f
```

If any row reads `t`, stop and re-run section 15.

## 2. Set `SUPABASE_SERVICE_ROLE_KEY`

Supabase - Project Settings - API - `service_role` key. Add it in Vercel for
Production and Preview.

This is server-only and bypasses RLS. Never prefix it with `NEXT_PUBLIC_`.
It exists so the quota counters are unreachable from the browser: if anon
could call `consume_quota` it could burn the global bucket itself and deny
service to everyone.

Without it, `/api/generate-report` refuses free-tier requests by design. An
unbounded server key is worse than a disabled free tier.

## 3. Refresh the lockfile

```
cd nixara-app && npm install
```

Picks up the `uuid` override that clears the exceljs advisory without
downgrading exceljs. Commit the resulting `package-lock.json`.

## Optional - tune the limits

Defaults are in `.env.example`. The one worth a deliberate decision is:

```
NIXARA_DAILY_FREE_SESSION_CAP=300
```

That is the hard ceiling on free generate-sessions per day across all callers,
and therefore the bound on your worst-case daily OpenAI bill. At three calls
per session it is on the order of a few dollars a day. Set it to whatever you
are willing to lose in a bad 24 hours.

Housekeeping: `select prune_quota(48);` drops expired counter rows. Worth a
weekly pg_cron job, but nothing breaks without it.

## Verify after deploy

- Generate a report as a new visitor - should work.
- Repeat past the per-IP limit - should get the "used all 3 free reports"
  message rather than silently spending your key.
- Confirm the Inter font still renders. `font-src` was tightened to `'self'`
  and the fonts CDN was unreachable in the sandbox, so this is the one change
  that could not be exercised before merge.
