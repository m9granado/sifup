# Revisión inline — canchas pagadas

Revisión propia, no revisión independiente: la delegación está deshabilitada. Scope: nuevos módulos court-payments/court-payment-service, migración, script offline y hunks nuevos de repository, MCP, acciones, tipos, store, standings y etiquetas del componente. No atribuir el resto del diff pendiente a esta tarea.

## Corregido durante verificación
- Contrato MCP previo necesitaba aislar también el nuevo servicio server-only; se amplió el stub sin relajar sus aserciones.
- Reintento del traslado debe seguir siendo idempotente después de jugar el destino.
- Actividad de origen se revisa incluso si ya figura suspendido, sin enmascarar resultados inconsistentes.
- Triggers SQL protegen también los caminos de Rey de la Cancha, no solo resultados clásicos.
- El vínculo directo se reemplaza dentro de la misma transacción para impedir suspender un destino con crédito sin trasladarlo.
- Lectura posterior verifica asignación, destino y suspensión del origen.
- ESLint: renombrada variable module del script para cumplir regla Next.

## Simplificación
Reutiliza Match, ClubExpense, getSifupData, postgres, Server Actions, SDK MCP y componentes/etiquetas actuales. Sin dependencias nuevas de producción. PGlite vive solo en scratch para pruebas. Operación financiera serializada por volumen bajo; no se añadió motor contable, caché ni infraestructura de agentes.

## Pendientes de aceptación
Bloqueo UX/Erina y navegador; controles y saldo prepago legado no resueltos. Migración no aplicada a datos reales, sin release ni prueba de concurrencia multisesión. Ver SUMMARY.md.
