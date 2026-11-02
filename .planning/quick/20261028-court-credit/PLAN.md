# Canchas pagadas y fechas suspendidas

## Acuerdo confirmado
Solo se jugó el 27 de octubre de 2026. Los créditos de las fechas 6, 13 y 20 de octubre se aplicarán respectivamente al 3, 10 y 17 de noviembre, al mismo valor. Conservar fecha y monto del desembolso original. No publicar ni modificar datos reales en esta tarea.

## Alcance y aceptación
- Vincular un gasto existente de categoría cancha con el partido que cubre; no inventar gastos ni importes.
- Trasladar el crédito a una nueva fecha conservando el partido original suspendido, su plantilla y todos los pagos de jugadores.
- Crear el partido destino si no existe, sin copiar jugadores, pagos ni resultados.
- Operaciones atómicas, repetibles sin duplicación y rechazo de sobreasignación, resultados existentes y costos incompatibles.
- Consulta MCP distingue desembolso, costo asignado, consumido y crédito programado por mes; mismos servicios para app.
- Pruebas offline, TypeScript, lint y build sin conexión a datos reales.

## Restricciones / revisión
El checkout contiene cambios ajenos pendientes: preservarlos. No ejecutar db:schema ni scripts contra DATABASE_URL. No hay mensajería interna habilitada hacia Erina; no cerrar UX ni diseñar nuevos controles hasta obtener su revisión mediante Bernardo. La implementación de dominio, persistencia y MCP no depende del diseño visual.
