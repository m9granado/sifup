# Corrección Mella — octubre 2026 — aplicada por MCP

## Autorización
El humano aclaró que no quería cobrarle dos mensualidades y, ante la pregunta explícita por mes, seleccionó en clarify: "Octubre de 2026 (mes 10, partido del 27)". No se autorizó cambiar septiembre ni noviembre.

## Lectura previa
- Identidad MCP: player-mella.
- Octubre: mensualidad pendiente $20.000, no pagada; galleta del 27/10 en cero por cobertura mensual.
- 06/10 y 13/10: Mella confirmado, sin importes pagados, amountDue=0; notas de partido POSPUESTO por lluvia — no se jugó.
- 20/10: partido sin jugadores.
- Noviembre: effectivePaymentPlan monthly, sin deuda mensual de Mella; único pendiente mensual Danniels Nettle.

## Escrituras ejecutadas
1. set_monthly_roster(playerId=player-mella, monthKey=2026-10, monthly=false, cancelGalletas=false). Resultado removed, repricedToGalleta=3, discardedPaidMonthlyAmount=0.
2. update_match_player para mp-1791164042593-lr9g66 (match-2026-10-06): amountDue=0, amountPaid=0, paymentStatus=paid; nota de pospuesto sin cobro.
3. update_match_player para mp-1791841250718-2wkcem (match-2026-10-13): mismos valores y nota. No cambiar asistencia, equipo ni orden.

La operación existente de roster recalcula todas las filas confirmadas del mes, incluso fechas pospuestas que aún no tienen status suspended. Se corrigieron inmediatamente los dos cobros no procedentes, exclusivamente mediante MCP. No interpretar paymentStatus=paid con importe cero como un ingreso.

## Verificación posterior independiente
- get_next_match_summary(match-2026-10-27): match-2026-10-27-player-6, Mella, effectivePaymentPlan perMatch, amountDue=5000, amountPaid=0, paymentStatus unpaid, equipo B y orden6 conservados.
- get_pending_payments(2026-10): Mella no aparece en monthlyPending; en octubre solo aparece su deuda del 27 por $5.000, no del 6 o 13. Persisten deudas históricas de agosto, no modificadas.
- find_player(query=Nicolás Mella,monthKey=2026-11): player-mella sigue monthly/roster.
- get_pending_payments(2026-11): Mella sigue sin pendiente mensual; único pendiente mensual Danniels Nettle por $20.000. La sección perMatch incluye deudas históricas, no equivale a deudas exclusivas de noviembre.

## Pendiente de desarrollo
Evitar que el cambio mensual→galleta genere cobros por fechas no jugadas; operación selectiva o clasificación explícita de suspensión, con una prueba de regresión y garantías transaccionales. No repetir set_monthly_roster indiscriminadamente: volvería a cobrar filas confirmadas en cero. Esta tarea no cambió partidos, créditos de cancha, septiembre, noviembre ni código publicado.
