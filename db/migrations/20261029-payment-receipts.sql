-- Additive and repeatable. No historical backfill: updated_at is not receipt time.
-- Date-only receipts use paid_date with paid_at NULL; explicit times use UTC paid_at.
alter table monthly_payments add column if not exists paid_date date;
alter table match_players add column if not exists paid_at timestamptz;
alter table match_players add column if not exists paid_date date;
