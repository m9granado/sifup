---
status: incomplete
---

# Canchas octubre → noviembre

## Publicación autorizada posterior
Publicado en producción en https://sifup.vercel.app por solicitud explícita del humano. Commit main `41c54271588a7eb2bafb87f43a331cfd2ceae6b5` (feature `44afd5e` y reparación test-only `41c5427` para aserciones WhatsApp ya desfasadas en main). Deployment `dpl_6xtY7fonPLmR8YwU3JsRAcUrJ2oe`, URL `sifup-l1r4g7h3h-m9-granado-s-projects.vercel.app`, READY, alias canónico verificado y estado GitHub/Vercel success.

Migración aplicada antes del push; backup lógico privado: `C:/Users/mgran/AppData/Local/hermes/profiles/codificador/workspace/backups/sifup/before-court-migration-2026-10-29T00-49-50-314Z.json`. Readback: tabla court_payments, 6 triggers y constraint suspended verificados, cero asignaciones y hashes iguales de todas las filas originales. Evidencia detallada sin credenciales en scratch `sifup-production-migration-evidence.json`.

Release aislado de origin/main sin cambios ajenos de OAuth/login/UI. Pruebas de ese checkout: 63/63, tsc, build, lint sin errores (5 warnings existentes), PostgreSQL/MCP offline PASS. Smoke producción: /matches y /login 200, /payments 307 a /login, /mcp sin credencial 401. No se verificaron tools autenticadas en vivo: token Vercel marcado sensible no exportable y ausente localmente. No se aplicaron los traslados ni se alteraron pagos de jugadores. Checkout original y cambios restaurados, stash de seguridad conservado. La UI sigue pendiente; esta publicación no cierra ese criterio de aceptación.

## Entrega local verificada
- Dominio: gasto original vinculado a cancha, origen suspendido y destino al mismo valor. Reporte diferencia caja, costo registrado de partidos jugados, consumo vinculado y crédito programado. Registros sin vínculo quedan explícitos.
- Persistencia: nueva migración `db/migrations/20261028-court-payments.sql`, restricciones/guardas SQL, operación transaccional e idempotente; conserva plantilla, pagos de jugadores y resultados.
- MCP: `get_court_finances`, `link_court_payment`, `transfer_court_payment`. Simulación por defecto; `dryRun=false` escribe. Readback de asignación y partidos después de escribir.
- App: server actions con permisos payments + matches para escribir. Etiqueta Suspendido y exclusión de próxima fecha/ranking. No hay nuevos controles financieros ni reemplazo del saldo prepago legado.
- README contiene límites y prerequisito de migración. `db:schema` incluye nueva migración; no se ejecutó contra una base real.

## Evidencia ejecutada
- `npm test`: 69/69 pasan (incluye 10 pruebas nuevas de dominio).
- `npx tsc --noEmit`: exit 0.
- ESLint de archivos afectados y script: 0 errores; 5 warnings de variables sin uso en secciones no modificadas del componente existente.
- `npm run build` con DATABASE_URL/DATABASE_URL_UNPOOLED/POSTGRES_DATABASE vacíos: exit 0, compilación y generación completas.
- `scripts/check-court-payments-db.mjs` con PGlite en scratch: PASS. PostgreSQL en memoria, migración repetida, repositorio real mediante adaptador tagged SQL, traslado de vínculo directo, rollback ante fallo SQL inyectado, conservación de pagos, guardas de fechas/resultados, consumo, server actions con autorización simulada y MCP HTTP/SDK real para auth/list/report/preview/apply/retry.
- `git diff --check`: exit 0. Cambios ajenos iniciales conservados; sin commit/push.

## Límites y bloqueo
No se modificaron datos reales ni se publicó. Los valores de pruebas son sintéticos, no importes comprobados del club. No se probó Supabase de producción, concurrencia multisesión ni UI renderizada. El navegador compartido no respondió en la inspección inicial. No hay mensajería interna habilitada para solicitar la revisión UX de Erina: solicitar derivación mediante Bernardo antes de cerrar brief visual y nuevos controles. Los traslados encadenados no están soportados.

## Siguiente paso
Revisión de Erina para mostrar pago/crédito y operación de traslado en partidos y finanzas (sin alterar fecha del desembolso). Implementar controles, reemplazar saldo prepago legado y comprobar render. Antes de publicar: respaldo, migración explícita, aprobación de release y consulta autenticada de gastos reales; previsualizar los traslados 2026-10-06→2026-11-03, 2026-10-13→2026-11-10, 2026-10-20→2026-11-17 con el gasto correcto. Aplicar y releer solamente con autorización operativa.
