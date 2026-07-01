delete from match_results;
delete from match_players;
delete from monthly_payments;
delete from matches;
delete from players;
delete from club_finances;

insert into players (id, name, nickname, phone, payment_plan, skill_level, active)
values
  ('player-victor', 'Victor', 'Victor', '', 'monthly', 1, true),
  ('player-marcio', 'Marcio', 'Marcio', '', 'monthly', 2, true),
  ('player-mario-q', 'Mario Quintana', 'Mario Q', '', 'monthly', 3, true),
  ('player-mella', 'Mella', 'Mella', '', 'monthly', 4, true),
  ('player-juanjo', 'Juanjo', 'Juanjo', '', 'monthly', 5, true),
  ('player-francis', 'Francis', 'Francis', '', 'monthly', 1, true),
  ('player-cooper', 'Cooper', 'Cooper', '', 'monthly', 2, true),
  ('player-caldera', 'Caldera', 'Caldera', '', 'monthly', 3, true),
  ('player-alonso', 'Alonso', 'Alonso', '', 'monthly', 4, true),
  ('player-ale-moran', 'Ale Moran', 'Ale', '', 'perMatch', 5, true),
  ('player-amigo-ale-arquero', 'Amigo Ale M Arquero', 'Arquero Ale', '', 'perMatch', 1, true),
  ('player-amigo-2-ale', 'Amigo 2 Ale Moran', 'Amigo Ale 2', '', 'perMatch', 2, true),
  ('player-stgo-mantelli', 'Stgo Mantelli', 'Mantelli', '', 'perMatch', 3, true),
  ('player-piti', 'Piti', 'Piti', '', 'perMatch', 4, true),
  ('player-matias', 'Matias', 'Matias', '', 'perMatch', 5, true),
  ('player-beto', 'Beto', 'Beto', '', 'perMatch', 1, true),
  ('player-pololo-francis', 'Pololo de Francis', 'Pololo Francis', '', 'perMatch', 2, true),
  ('player-galleta', 'Galleta', 'Galleta', '', 'perMatch', 3, true),
  ('player-felipe-arquero', 'Felipe arquero', 'Felipe', '', 'perMatch', 4, true);

insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes)
values
  ('match-2026-06-30', '2026-06-30', '21:00', 'Club Sordos, Av. Jose Pedro Alessandri 1251, Nunoa', 'confirmed', 35000, '3a sem Jun', '2026-06', 35000, true, 'Tercer partido. Cancha ya pagada dentro del paquete de 5 canchas.'),
  ('match-2026-06-23', '2026-06-23', '21:00', 'Club Sordos, Av. Jose Pedro Alessandri 1251, Nunoa', 'played', 35000, '2a sem Jun', '2026-06', 35000, true, 'Futbolito martes 23 junio. Segundo partido registrado.'),
  ('match-2026-06-09', '2026-06-09', '21:00', 'Cancha de los Sordos', 'played', 35000, '1a sem Jun', '2026-06', 35000, true, 'Martes 09/06. 3.000 por persona. Primer partido registrado.');

insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, amount_paid, note, whatsapp_order, team)
values
  ('match-2026-06-30-player-1', 'match-2026-06-30', 'player-victor', 'Victor', 'confirmed', 'paid', 0, 0, 'mensualidad', 1, 'A'),
  ('match-2026-06-30-player-2', 'match-2026-06-30', 'player-galleta', 'Galleta', 'confirmed', 'unpaid', 3500, 0, '', 2, 'none'),
  ('match-2026-06-30-player-3', 'match-2026-06-30', 'player-marcio', 'Marcio', 'confirmed', 'paid', 0, 0, 'mensualidad', 3, 'B'),
  ('match-2026-06-30-player-4', 'match-2026-06-30', 'player-juanjo', 'Juanjo', 'confirmed', 'paid', 0, 0, 'mensualidad', 4, 'A'),
  ('match-2026-06-30-player-5', 'match-2026-06-30', 'player-beto', 'Beto', 'confirmed', 'unpaid', 3500, 0, '', 5, 'none'),
  ('match-2026-06-30-player-6', 'match-2026-06-30', 'player-francis', 'Francis', 'confirmed', 'paid', 0, 0, 'mensualidad', 6, 'B'),
  ('match-2026-06-30-player-7', 'match-2026-06-30', 'player-cooper', 'Cooper', 'confirmed', 'paid', 0, 0, 'mensualidad', 7, 'A'),
  ('match-2026-06-30-player-8', 'match-2026-06-30', 'player-stgo-mantelli', 'Stgo Mantelli', 'confirmed', 'unpaid', 3500, 0, '', 8, 'B'),
  ('match-2026-06-30-player-9', 'match-2026-06-30', 'player-pololo-francis', 'Pololo de Francis', 'confirmed', 'unpaid', 3500, 0, '', 9, 'none'),
  ('match-2026-06-30-player-10', 'match-2026-06-30', 'player-mario-q', 'Mario Quintana', 'confirmed', 'paid', 0, 0, 'mensualidad', 10, 'A'),
  ('match-2026-06-30-player-11', 'match-2026-06-30', 'player-alonso', 'Alonso Duran', 'confirmed', 'promised', 3500, 0, 'pago manana', 11, 'B'),
  ('match-2026-06-30-player-12', 'match-2026-06-30', 'player-felipe-arquero', 'Felipe arquero', 'confirmed', 'unpaid', 3500, 0, 'galleta Cooper', 12, 'none'),
  ('match-2026-06-23-player-1', 'match-2026-06-23', 'player-victor', 'Victor', 'confirmed', 'paid', 0, 0, 'pagado fijo', 1, 'A'),
  ('match-2026-06-23-player-2', 'match-2026-06-23', 'player-marcio', 'Marcio', 'confirmed', 'paid', 0, 0, 'pagado fijo', 2, 'B'),
  ('match-2026-06-23-player-3', 'match-2026-06-23', 'player-mario-q', 'Mario Quintana', 'confirmed', 'paid', 0, 0, 'pagado fijo', 3, 'A'),
  ('match-2026-06-23-player-4', 'match-2026-06-23', 'player-mella', 'Mella', 'confirmed', 'paid', 0, 0, 'pagado fijo', 4, 'B'),
  ('match-2026-06-23-player-5', 'match-2026-06-23', 'player-juanjo', 'Juanjo', 'confirmed', 'paid', 0, 0, 'pagado fijo', 5, 'A'),
  ('match-2026-06-23-player-6', 'match-2026-06-23', 'player-francis', 'Francis', 'confirmed', 'paid', 0, 0, 'pagado fijo', 6, 'B'),
  ('match-2026-06-23-player-7', 'match-2026-06-23', 'player-ale-moran', 'Ale Moran', 'confirmed', 'promised', 3500, 0, 'Galleta Cooper por manana', 7, 'A'),
  ('match-2026-06-23-player-8', 'match-2026-06-23', 'player-amigo-ale-arquero', 'Amigo Ale M Arquero', 'confirmed', 'promised', 3500, 0, 'Galleta Cooper por manana', 8, 'B'),
  ('match-2026-06-23-player-9', 'match-2026-06-23', 'player-amigo-2-ale', 'Amigo 2 Ale Moran', 'confirmed', 'promised', 3500, 0, 'Galleta Cooper por manana', 9, 'A'),
  ('match-2026-06-23-player-10', 'match-2026-06-23', 'player-stgo-mantelli', 'Stgo Mantelli', 'confirmed', 'unpaid', 3500, 0, '', 10, 'B'),
  ('match-2026-06-23-player-11', 'match-2026-06-23', 'player-cooper', 'Cooper', 'out', 'paid', 0, 0, 'No puede. Pagado fijo', 11, 'none'),
  ('match-2026-06-23-player-12', 'match-2026-06-23', 'player-caldera', 'Caldera', 'out', 'paid', 0, 0, 'No puede. Pagado fijo', 12, 'none'),
  ('match-2026-06-23-player-13', 'match-2026-06-23', 'player-alonso', 'Alonso', 'out', 'paid', 0, 0, 'No puede. Pagado, enfermo', 13, 'none'),
  ('match-2026-06-09-player-1', 'match-2026-06-09', 'player-marcio', 'Marcio', 'confirmed', 'paid', 0, 0, '', 1, 'A'),
  ('match-2026-06-09-player-2', 'match-2026-06-09', 'player-juanjo', 'Juanjo', 'confirmed', 'paid', 0, 0, '', 2, 'B'),
  ('match-2026-06-09-player-3', 'match-2026-06-09', 'player-victor', 'Victor', 'confirmed', 'paid', 0, 0, '', 3, 'A'),
  ('match-2026-06-09-player-4', 'match-2026-06-09', 'player-cooper', 'Cooper', 'confirmed', 'paid', 0, 0, '', 4, 'B'),
  ('match-2026-06-09-player-5', 'match-2026-06-09', 'player-mario-q', 'Mario Quintana', 'confirmed', 'paid', 0, 0, '', 5, 'A'),
  ('match-2026-06-09-player-6', 'match-2026-06-09', 'player-piti', 'Piti', 'confirmed', 'paid', 3000, 3000, '', 6, 'B'),
  ('match-2026-06-09-player-7', 'match-2026-06-09', 'player-caldera', 'Caldera', 'confirmed', 'paid', 0, 0, '', 7, 'A'),
  ('match-2026-06-09-player-8', 'match-2026-06-09', 'player-mella', 'Mella', 'confirmed', 'paid', 0, 0, '', 8, 'B'),
  ('match-2026-06-09-player-9', 'match-2026-06-09', 'player-alonso', 'Alonso', 'confirmed', 'paid', 0, 0, '', 9, 'A'),
  ('match-2026-06-09-player-10', 'match-2026-06-09', 'player-matias', 'Matias', 'confirmed', 'paid', 3000, 3000, 'primo Juanjo', 10, 'B');

insert into monthly_payments (id, player_id, month_key, expected_amount, amount_paid, payment_status, note)
select 'monthly-2026-06-' || id, id, '2026-06', 20000, 20000, 'paid', 'Mensualidad junio'
from players
where payment_plan = 'monthly';

insert into match_results (id, match_id, score_a, score_b, winner, notes)
values
  ('result-2026-06-23', 'match-2026-06-23', 0, 0, 'draw', 'Resultado por completar.'),
  ('result-2026-06-09', 'match-2026-06-09', 0, 0, 'draw', 'Resultado por completar.');

insert into club_finances (id, bank, account, email, rut, court_cost, prepaid_courts, prepaid_total, notes)
values ('club-finance-main', 'Cuenta vista Banco BCI MACH', '777915748221', 'vigomez@uchile.cl', '157482211', 35000, 5, 175000, '5 canchas pagadas en Club Sordos.');
