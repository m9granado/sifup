# Encargos autorizados pendientes de entrega a especialistas

## Estado vigente 2026-10-29 — no sustituir por antecedentes
La imagen SIFUP-MATCHES-VISUAL-01 ya fue recibida, verificada, aprobada por Marcio e implementada LOCALMENTE. NO reenviar el encargo antiguo de diseño de abajo. Ahora falta QA Erina de implementación y criterio/conciliación Faro, no otra lámina.

Ruta nativa actual comprobada mediante connect_gateway bajo perfil codificador: groups.state(room_id=sifup-coordinacion) devuelve permission_denied. Es acceso denegado a sala existente, no inexistencia ni inventario de peers. No se enviaron nuevos briefs ni se verificó recepción. No ampliar permisos/lanzar otro perfil. Bernardo debe resolver la ruta autorizada, conservando especialidades.

Brief QA preparado, NO enviado: Erina revisar `C:/Users/mgran/AppData/Local/hermes/profiles/codificador/workspace/artifacts/SIFUP-MATCHES-IMPLEMENTATION-20261029/{mobile.png,desktop.png,payments-mobile.png}` y fuentes `/matches` en MatchesList/SifupWorkspace. Correlación SIFUP-MATCHES-IMPLEMENTATION-20261029. Imágenes son render local de componentes reales, fixtures sintéticos, Arial y mocks de navegación/acciones, NO producción ni prueba integrada. Revisar jerarquía, acceso a todos los partidos, dos meses abiertos, estados diferenciados, plegado accesible, móvil/escritorio. Devolver hallazgos a Soma en misma sala con artefactos/versión e ID/seq si existe. La dirección humana ya está aprobada, no pedir repetir. La captura de pagos es propuesta provisional distinta: consultar jerarquía, no asumirla aprobada por la lámina matches.

Faro: pedido pertinente de abajo sigue sin respaldo recibido; además validar criterio de caja acumulada (saldo inicial conciliado + dinero recibido - desembolsado) y distinguir descuentos/aportes/transferencias internas. Implementación provisional LOCAL no inventa saldo inicial; recibos sin fecha se excluyen del subtotal fechado y se muestran aparte. No hacer negocio sin respaldo. Gasto técnico de junio no prueba crédito octubre/noviembre.

## Antecedentes históricos (no estado actual de envío)
Estado de aquella comunicación: NO enviados. No inventar destinatario ni ejecutar otro perfil para saltarse restricciones.

## Faro / financiero — conciliación de cancha SIFUP

Pedido explícito de Marcio: preguntar a Faro por otros gastos relacionados y sus transferencias. No asumir que el único gasto de cancha registrado en SIFUP representa todos los pagos reales.

Contexto verificado mediante MCP SIFUP `get_court_finances`, mes 2026-11:
- Solo aparece como gasto de cancha `expense-2026-06-courts`, fecha 2026-06-10, etiqueta Paquete 5 canchas Club Sordos, monto $175.000, sin asignaciones.
- Ese saldo técnico sin asignaciones NO prueba que el paquete siga disponible.
- Humano confirma que en octubre solo se jugó el 27; canchas pagadas del 6/13/20 deberían quedar a favor para 3/10/17 de noviembre.
- No se ejecutaron traslados, no se crearon gastos y no se modificaron pagos reales.

Solicitar a Faro:
1. Contrastar transferencias de Marcio relacionadas con cancha/SIFUP que cubran octubre y créditos hacia noviembre. Consultar únicamente movimientos pertinentes al encargo; no enviar historiales financieros completos.
2. Identificar pagos/gastos de cancha omitidos en SIFUP: fecha, importe, destinatario/concepto, estado efectivo y evidencia mínima/ID verificable.
3. Distinguir transferencia del administrador hacia la cancha, mensualidades de jugadores y crédito de reservas no utilizadas; evitar doble registro.
4. Confirmar qué gasto respalda cada fecha de octubre, si existe crédito reconocido por la cancha y cómo se aplica a noviembre.
5. Devolver conciliación o incertidumbres concretas, sin escribir datos ni ejecutar movimientos financieros. Soma aplicará después los cambios SIFUP por MCP dentro de las autorizaciones vigentes y con readback.

## Erina — propuesta visual en imagen de /matches

Pedido explícito de Marcio: diseñar https://sifup.vercel.app/matches en una imagen, agrupando los partidos por mes y compactando el historial.

Objetivo: destacar la próxima fecha y la actividad reciente, manteniendo meses antiguos fáciles de consultar sin una lista interminable. Proponer mes reciente abierto y meses históricos plegables/compactos, evaluando una alternativa mejor si existe.

Restricciones: respetar identidad visual actual; mobile-first; mostrar fechas y estados (confirmado, lista cerrada, jugado, suspendido) sin confundir suspensión con partido finalizado; no inventar importes ni presentar créditos como ya aplicados. La lógica nueva de crédito está publicada, pero los movimientos reales y nuevos controles financieros siguen pendientes.

Entregable requerido: imagen/mockup real del diseño, más una explicación breve de agrupación mensual, compactación/despliegue y tratamiento del próximo partido. Sin implementar código ni cambiar producción. Inspeccionar primero la página renderizada si dispone de navegador autorizado y aportar criterio propio, no solo asentimiento. Devolver ubicación verificable de la imagen.
