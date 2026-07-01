create table if not exists players (
  id text primary key,
  name text not null,
  nickname text not null default '',
  phone text not null default '',
  payment_plan text not null check (payment_plan in ('monthly', 'perMatch')),
  skill_level integer not null check (skill_level between 1 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  id text primary key,
  match_date date not null,
  match_time text not null,
  location text not null,
  status text not null check (status in ('open', 'confirmed', 'played', 'closed')),
  total_cost integer not null default 0,
  week_label text not null default '',
  month_key text not null default '',
  court_cost integer not null default 35000,
  court_prepaid boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists match_players (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  player_id text references players(id) on delete set null,
  name text not null,
  phone text not null default '',
  attendance_status text not null check (attendance_status in ('confirmed', 'maybe', 'out', 'waitlist')),
  payment_status text not null check (payment_status in ('paid', 'unpaid', 'promised')),
  amount_due integer not null default 0,
  amount_paid integer not null default 0,
  note text not null default '',
  team text not null check (team in ('A', 'B', 'none')),
  whatsapp_order integer,
  goals integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table match_players add column if not exists whatsapp_order integer;
alter table match_players add column if not exists phone text not null default '';

with ordered_match_players as (
  select id, row_number() over (partition by match_id order by created_at asc, id asc)::integer as next_order
  from match_players
  where whatsapp_order is null or whatsapp_order = 0
)
update match_players
set whatsapp_order = ordered_match_players.next_order
from ordered_match_players
where match_players.id = ordered_match_players.id;

create table if not exists match_results (
  id text primary key,
  match_id text not null unique references matches(id) on delete cascade,
  score_a integer not null default 0,
  score_b integer not null default 0,
  winner text not null check (winner in ('A', 'B', 'draw')),
  notes text not null default ''
);

create table if not exists monthly_payments (
  id text primary key,
  player_id text not null references players(id) on delete cascade,
  month_key text not null,
  expected_amount integer not null default 20000,
  amount_paid integer not null default 0,
  payment_status text not null check (payment_status in ('paid', 'unpaid', 'promised')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, month_key)
);

create table if not exists club_finances (
  id text primary key,
  bank text not null,
  account text not null,
  email text not null,
  rut text not null,
  court_cost integer not null,
  prepaid_courts integer not null,
  prepaid_total integer not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_match_players_match_id on match_players(match_id);
create index if not exists idx_match_players_player_id on match_players(player_id);
create index if not exists idx_match_players_whatsapp_order on match_players(match_id, whatsapp_order);
create index if not exists idx_matches_month_key on matches(month_key);
create index if not exists idx_monthly_payments_month_key on monthly_payments(month_key);
