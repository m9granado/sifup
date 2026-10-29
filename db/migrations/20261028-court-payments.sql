begin;

alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check
  check (status in ('open', 'confirmed', 'played', 'roster_locked', 'closed', 'suspended'));

create table if not exists court_payments (
  source_match_id text primary key references matches(id),
  target_match_id text not null unique references matches(id),
  expense_id text not null references club_expenses(id),
  amount integer not null check (amount > 0)
);
create index if not exists idx_court_payments_expense on court_payments(expense_id);

-- Lock the expense before checking its balance, including concurrent allocations.
create or replace function validate_court_payment() returns trigger language plpgsql as $$
declare
  expense club_expenses%rowtype;
  source matches%rowtype;
  target matches%rowtype;
  allocated bigint;
begin
  select * into expense from club_expenses where id = new.expense_id for update;
  perform id from matches where id in (new.source_match_id, new.target_match_id) order by id for update;
  select * into source from matches where id = new.source_match_id;
  select * into target from matches where id = new.target_match_id;
  if expense.id is null or source.id is null or target.id is null then
    raise exception 'Pago, origen o destino inexistente';
  end if;
  if expense.category <> 'court' or source.court_cost <> new.amount or target.court_cost <> new.amount then
    raise exception 'El pago debe cubrir una cancha al mismo valor';
  end if;
  select coalesce(sum(amount), 0) into allocated from court_payments
    where expense_id = new.expense_id and source_match_id <> new.source_match_id;
  if allocated + new.amount > expense.amount then raise exception 'Saldo de gasto insuficiente'; end if;
  if new.source_match_id <> new.target_match_id then
    if source.status <> 'suspended' or target.status = 'suspended' or target.match_date <= source.match_date then
      raise exception 'Traslado incompatible con las fechas o estados';
    end if;
    if exists (select 1 from match_results where match_id = source.id)
      or exists (select 1 from match_games where match_id = source.id)
      or exists (select 1 from match_teams where match_id = source.id and final_rank is not null) then
      raise exception 'No se puede trasladar una cancha con resultado o actividad';
    end if;
  elsif target.status = 'suspended' then
    raise exception 'No se puede aplicar el pago a una fecha suspendida';
  end if;
  return new;
end $$;
drop trigger if exists court_payment_valid on court_payments;
create trigger court_payment_valid before insert or update on court_payments
  for each row execute function validate_court_payment();

create or replace function protect_court_payment_match() returns trigger language plpgsql as $$
begin
  if exists (select 1 from court_payments where source_match_id = old.id or target_match_id = old.id) then
    if new.status = 'suspended' and exists (select 1 from court_payments where target_match_id = old.id) then
      raise exception 'Traslada el credito antes de suspender su partido destino';
    end if;
    if new.match_date <> old.match_date or new.court_cost <> old.court_cost then
      raise exception 'Un partido con pago vinculado no puede cambiar fecha o costo';
    end if;
    if exists (select 1 from court_payments where source_match_id = old.id and target_match_id <> old.id)
      and (new.status <> 'suspended' or new.court_prepaid) then
      raise exception 'La fecha original debe conservarse suspendida, sin consumir el credito trasladado';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists court_payment_match_protected on matches;
create trigger court_payment_match_protected before update on matches
  for each row execute function protect_court_payment_match();

-- Keep every result-writing path (classic and royal) consistent with suspension.
create or replace function protect_suspended_match_activity() returns trigger language plpgsql as $$
declare match_status text;
begin
  if tg_table_name = 'match_teams' then
    if new.final_rank is null then return new; end if;
  end if;
  select status into match_status from matches where id = new.match_id for update;
  if match_status = 'suspended' then raise exception 'Un partido suspendido no puede tener actividad o resultado'; end if;
  return new;
end $$;
drop trigger if exists suspended_result_protected on match_results;
create trigger suspended_result_protected before insert or update on match_results
  for each row execute function protect_suspended_match_activity();
drop trigger if exists suspended_game_protected on match_games;
create trigger suspended_game_protected before insert or update on match_games
  for each row execute function protect_suspended_match_activity();
drop trigger if exists suspended_rank_protected on match_teams;
create trigger suspended_rank_protected before insert or update on match_teams
  for each row execute function protect_suspended_match_activity();

create or replace function protect_linked_court_expense() returns trigger language plpgsql as $$
begin
  if (new.amount <> old.amount or new.expense_date <> old.expense_date or new.category <> old.category)
    and exists (select 1 from court_payments where expense_id = old.id) then
    raise exception 'No se puede alterar el importe, fecha o categoria de un gasto vinculado';
  end if;
  return new;
end $$;
drop trigger if exists linked_court_expense_protected on club_expenses;
create trigger linked_court_expense_protected before update on club_expenses
  for each row execute function protect_linked_court_expense();

commit;
