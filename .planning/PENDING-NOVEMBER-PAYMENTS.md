# Instrucciones humanas pendientes — pagos noviembre 2026

Fuente: instrucción humana de la sesión codificador/20261028_210127_6a4e7240, mensaje 1639. Reactivada en sala SIFUP el 2026-10-29. El MCP del perfil codificador ya está conectado; el estado aplicado y sus límites se detallan abajo.

## Estado informado
Cuota fija noviembre: $20.000.
- Cris: fijo noviembre, pagado $20.000.
- Germán: fijo noviembre, pagado $20.000. Galleta de "ayer" pendiente $5.000, separada de la cuota de noviembre.
- Nicolás Mella: fijo noviembre, pagado $20.000. Galleta de "ayer" pendiente $5.000, separada de la cuota de noviembre.
- Marcio: fijo noviembre, pagado $20.000.
- Danniels Nettle: fijo noviembre; paga viernes, aún no informado como pagado. No convertir la promesa en un pago ni inventar fecha exacta de viernes.
- Diego Vergara: fijo noviembre, pagado $20.000.

## Al recuperar MCP
1. Resolver cada nombre contra jugadores existentes, conservando literalmente los nombres proporcionados hasta verificar IDs (incluido "Danniels Nettle"). No crear duplicados ni asociar por intuición.
2. Leer cuotas de 2026-11 y filas de partido antes de escribir, preservar pagos existentes y no duplicar abonos.
3. Registrar estado mensual/fijo con las herramientas y esquemas reales del MCP. No asumir que "fijo" y paymentStatus prometido son equivalentes; conservar el compromiso de viernes en nota o campo soportado.
4. Leer el partido al que se refiere "ayer"; el contexto de esta conversación identifica el 2026-10-27 como el último jugado. Verificar filas e importes de galleta de Germán y Nicolás Mella, sin borrar/compensar esa deuda al registrarlos como mensuales de noviembre.
5. Releer los registros exactos y reportar únicamente lo verificado.

## Otro encargo pendiente
Traslados de créditos 2026-10-06→2026-11-03, 2026-10-13→2026-11-10, 2026-10-20→2026-11-17, por MCP, con gasto existente y mismo valor. Código y migración publicados, pero movimientos reales no ejecutados.

## Ejecución MCP 2026-10-29 — no repetir escrituras verificadas
- Resolución: Cris → Pitico (`player-1786492111869-cg9huo`, alias Cris); Germán → `player-german`; Nicolás Mella → `player-mella`; Marcio → `player-marcio`; Danniels Nettle → `player-danniels-nettle` (NO fusionar con Daniel Nettle); Diego Vergara → Diego V. (`player-diego`).
- Se agregaron como fijos 2026-11 Cris, Germán, Mella, Danniels y Diego; se releyó cada effectivePaymentPlan=monthly con find_player. Marcio ya era mensual y no se reescribió.
- cancelGalletas=true quedó acotado a noviembre: cubrió las filas de 03/11 de Cris, Danniels y Diego; no se tocaron galletas históricas.
- Se registraron como pagadas las cuotas de $20.000 de Cris (paidAt 2026-10-29T09:43:45.036Z), Germán (09:43:59.378Z), Mella (09:43:59.649Z) y Diego (09:43:59.916Z). register_monthly_payment establece el estado, no suma otro abono. Marcio ya estaba mensual sin deuda en la primera lectura y se preservó.
- Relectura get_pending_payments(2026-11): único monthlyPending Danniels Nettle, unpaid, expected=20000, pending=20000. No convertir su promesa del viernes en dinero recibido. El esquema MCP no expone nota/fecha de compromiso mensual; se conserva aquí.
- Discrepancia previa a cualquier escritura: en match-2026-10-27, German sí debe $5.000 (fila match-2026-10-27-player-10). Mella figura mensual, paid, amountDue=0, amountPaid=0 (fila match-2026-10-27-player-6). No crearle deuda de $5.000 ni revertir octubre sin aclaración. La relectura final de pendientes conserva la deuda de Germán y no muestra deuda de Mella del 27/10.
- Canchas: get_court_finances de octubre/noviembre solo devuelve expense-2026-06-courts, fecha 2026-06-10, $175.000, técnicamente unallocated; NO prueba saldo real disponible. Noviembre: match-2026-11-03, costo $35.000, payment=null, scheduledCredit=0. Ningún traslado ejecutado, ninguna reserva creada.

## Coordinación vigente
Sala SIFUP autorizada con menciones limpias (espacio después del handle, sin puntuación pegada). Faro debe aportar evidencia pertinente del gasto real de octubre y criterio sobre la discrepancia de Mella, sin mutaciones. Erina revisa el flujo renderizado de pagos noviembre cuando reciba encargo. Bernardo entrega resultados a Marcio por Telegram y confirma message_id; Soma no envía a Telegram. No reutilizar credenciales/MCP de otro perfil.
