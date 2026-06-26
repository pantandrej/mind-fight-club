# BFC Supabase SQL Migrations

Run these files in order in the Supabase SQL Editor (Dashboard → SQL Editor).

## Order of execution

| File | What it does |
|------|-------------|
| `01_schema_quiz_passes.sql` | Creates `quiz_passes` and `quiz_pass_purchases` tables with RLS |
| `02_rpc_purchase_quiz_pass.sql` | Atomic ticket purchase with `FOR UPDATE` row locking — prevents overselling |
| `03_rpc_cancel_quiz_pass.sql` | Organizer cancels pass → refunds all buyers atomically |
| `04_rpc_award_and_spend.sql` | `award_currency()` (idempotent, server-authoritative amounts) + `spend_neurons()` (atomic balance lock) + `currency_ledger` table |
| `05_rpc_streak_freeze.sql` | `buy_streak_freeze()` + `record_daily_activity()` with auto-freeze logic |

## Security model

- **SECURITY DEFINER** — all RPCs run as the DB owner, not the caller
- **FOR UPDATE** — row lock prevents race conditions / overselling under concurrency
- **Client sends zero amounts** — `purchase_quiz_pass` reads price from DB; `award_currency` looks up amount by operation type
- **Idempotency keys** — `currency_ledger` unique constraint on `(user_id, operation_key)` prevents double-award on network retry
- **UNIQUE constraint** on `quiz_pass_purchases(pass_id, buyer_id)` as second line of defense against duplicate purchase

## Verify after running

```sql
-- Check functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
AND routine_name IN ('purchase_quiz_pass','cancel_quiz_pass','award_currency','spend_neurons','buy_streak_freeze','record_daily_activity');

-- Check tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('quiz_passes','quiz_pass_purchases','currency_ledger');
```
