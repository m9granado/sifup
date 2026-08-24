create table if not exists app_users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_permissions (
  user_id text not null references app_users(id) on delete cascade,
  permission text not null check (permission in ('dashboard', 'matches', 'players', 'payments', 'standings', 'users')),
  primary key (user_id, permission)
);

create table if not exists players (
  id text primary key,
  name text not null,
  nickname text not null default '',
  phone text not null default '',
  payment_plan text not null check (payment_plan in ('monthly', 'perMatch')),
  skill_level integer not null check (skill_level between 1 and 5),
  active boolean not null default true,
  short_name text not null default '',
  is_goalkeeper boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table players add column if not exists is_goalkeeper boolean not null default false;

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

alter table matches add column if not exists match_format text not null default 'clasico' check (match_format in ('clasico', 'rey_de_la_cancha'));

create table if not exists match_teams (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  name text not null,
  color text not null default 'red' check (color in ('red', 'gold', 'green', 'cyan')),
  seq integer not null default 1,
  final_rank integer check (final_rank between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, seq)
);

alter table match_players add column if not exists team_id text references match_teams(id) on delete set null;

create table if not exists match_games (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  seq integer not null,
  home_team_id text not null references match_teams(id) on delete cascade,
  away_team_id text not null references match_teams(id) on delete cascade,
  waiting_team_id text references match_teams(id) on delete cascade,
  score_home integer not null default 0,
  score_away integer not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'finished')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('goal_diff', 'time_limit')),
  winner_team_id text references match_teams(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, seq)
);

create table if not exists monthly_payments (
  id text primary key,
  player_id text not null references players(id) on delete cascade,
  month_key text not null,
  expected_amount integer not null default 20000,
  amount_paid integer not null default 0,
  payment_status text not null check (payment_status in ('paid', 'unpaid', 'promised')),
  note text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, month_key)
);

alter table monthly_payments add column if not exists paid_at timestamptz;

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

create table if not exists club_expenses (
  id text primary key,
  expense_date date not null,
  label text not null,
  amount integer not null,
  category text not null check (category in ('court', 'equipment', 'other')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_match_players_match_id on match_players(match_id);
create index if not exists idx_match_players_player_id on match_players(player_id);
create index if not exists idx_match_players_whatsapp_order on match_players(match_id, whatsapp_order);
create index if not exists idx_match_players_team_id on match_players(team_id);
create index if not exists idx_match_teams_match_id on match_teams(match_id);
create index if not exists idx_match_games_match_id on match_games(match_id);
create index if not exists idx_matches_month_key on matches(month_key);
create index if not exists idx_monthly_payments_month_key on monthly_payments(month_key);
create index if not exists idx_club_expenses_expense_date on club_expenses(expense_date);
