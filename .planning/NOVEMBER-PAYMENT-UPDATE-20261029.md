# Actualización noviembre — 2026-10-29 — operaciones MCP verificadas

Fuente: actualización de Marcio en esta conversación. Se consultaron identidades de todos los nombres, membresía efectiva 2026-11, pendientes y partido 2026-10-27 antes de escribir. No se usó SQL/HTTP alternativo ni se repitieron pagos ya registrados.

## Estado de los nombres de la lista
- Cris → player-1786492111869-cg9huo, Pitico (alias explícito Cris): mensual noviembre, sin pendiente mensual; conservado sin escritura.
- Germán → player-german: mensual noviembre sin pendiente mensual; galleta 27/10 por $5.000 pendiente, conservada.
- Nicolás Mella → player-mella: mensual noviembre sin pendiente mensual; galleta 27/10 por $5.000 pendiente, conservada.
- Marcio → player-marcio: mensual noviembre sin pendiente mensual; conservado sin escritura ni sobrescribir paidAt. Humano informa recepción 28/10/2026. El MCP no permite editar/consultar el paidAt existente de esta cuota; esa fecha informada queda documentada aquí, no se afirma corregida en el campo de SIFUP.
- Danniels Nettle → player-danniels-nettle (coincidencia exacta; distinto del registro Daniel Nettle): mensual noviembre pendiente $20.000, promesa de viernes no marcada como recibida.
- Diego Vergara → player-diego, Diego V.: mensual noviembre sin pendiente mensual, conservado.
- Cooper → player-cooper: inicialmente NO pertenecía al roster noviembre (aunque plan global monthly). Se agregó con set_monthly_roster(monthKey=2026-11,monthly=true,cancelGalletas=false), sin cancelar galletas. Se releyó membership monthly y deuda esperada $20.000; se registró paid=true. Respuesta amountPaid=20000, expectedAmount=20000, paidAt=2026-10-29T10:56:28.999Z (fecha local 29/10, coincide con lo informado). Lectura posterior: monthly y sin pendiente mensual.

## Jonathan Lorca — galleta del 27 de octubre
Identidad existente resuelta: player-1786977599986-2sa4sc, nombre Jonathan, fila match-2026-10-27-player-12. Lectura previa: amountDue=5000, amountPaid=0, unpaid.
- register_match_payment con matchId explícito match-2026-10-27, amount=5000. Respuesta paid, amountPaid=5000, pendiente0.
- update_match_player solo de nota para conservar la referencia humana: pago de cancha 27/10/2026, recibido 28/10/2026 00:02, según Marcio. No se modificaron equipo A, asistencia confirmed u orden12.
- Readback posterior get_next_match_summary: amountDue=5000, amountPaid=5000, paymentStatus paid, nota de fecha/hora conservada.

Limitación: el MCP de registro de galletas no expone fecha/hora de recepción; la fecha histórica se conservó como nota, no como campo estructurado ni como fecha de captura de hoy.

## Verificación final
get_pending_payments(2026-11): único monthlyPending Danniels Nettle, $20.000; Cooper ya no pendiente. find_player Cooper noviembre sigue monthly/roster. get_next_match_summary 27/10: Jonathan pagado $5.000; Germán y Mella mantienen $5.000 pendientes cada uno. Jonathan aún tiene otra galleta de noviembre en la lista: no se pagó por arrastre ni se confundió con octubre. No se alteraron otras deudas de H/Matias o históricas.

Cálculo de la lista recibida: seis mensualidades pagadas de $20.000 = $120.000 asignados a noviembre, cuota Danniels pendiente $20.000; pago Jonathan octubre $5.000. No interpretar esos subtotales como saldo de caja real del club.
