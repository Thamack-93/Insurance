# Insurance closure tracker

Última actualización: 2026-10-05. Inventario consolidado para este chat y los chats fuente. Evidencia de código y operaciones separada; no declarar DEMO lista hasta pasar los gates de corte y acceso.

## Chats fuente

| Chat | Thread | Entrega transferida |
| --- | --- | --- |
| Coordina los chats del proyecto | 01a0f61d-4183-7480-b783-b034e027858a | Coordinación e inventario común |
| Add vehicle descriptions to policies | 01a0f5e6-2b9f-72c1-90d7-6df71043b287 | Identificación de pólizas y cotejo documental |
| Audit Demo organization support | 01a0f587-a833-7f81-a2ff-110a3f089bdd | Capacidades y aislamiento DEMO |
| Audit PolicyDesk demo sandbox | 01a0adb3-f260-76d0-8acc-4dac70465893 | Restore temporal Neon y aislamiento |
| Certify PolicyDesk demo access | 01a0c49b-0147-79c3-9b14-57063e8f8c2f | Certificación de acceso DEMO |
| Corrige seguimiento de renovaciones | 01a0fe42-c8bf-7223-9601-1b8a3cd7a4e1 | Renovaciones y pendientes operativos; chat archivado |

Los otros cuatro chats permanecen abiertos hasta cerrar los entregables transferidos.

## Estado verificado

- PR #73 (campos estructurados por ramo), #78 (reporte auditable de backfill) y #80 (preview read-only) están integrados.
- Vercel Production: el último deployment documental está `READY` en SHA `1613560ca61a6a284a319a4533bbc6471c7dcb12`; el código de aplicación sigue en `cfd223e90ff4a37f2ba493bad36b6625569c82d3`, alias `policypete.vercel.app`.
- GitHub Actions run #464 terminó `SUCCESS` en el head `b8d16e5` de PR #82: quality, tenant-isolation y application. Application incluyó restore/backfill integration en PostgreSQL desechable, build, API y E2E; tenant-isolation pasó migraciones, fixture de dos organizaciones, RLS y Chromium E2E con rol restringido. La base desechable se eliminó.
- La certificación local previa del snapshot exacto `cfd223e` pasó build, 16 tests tenant, RLS (42 tablas, 27 checks de contexto, 24 workers), drift, auditoría multi-org y 11 tests API/browser. Es evidencia complementaria, no reemplazo de CI.
- Insights autenticado cargó en Production: 121 renovaciones, 1 señal de cobranza, 0 siniestros y 4 de trabajo. La primera página incluye renovaciones vencidas desde 2024/2025. Es backlog operativo que requiere revisión humana; no se modificaron registros.

## Pendientes y aceptación

| Tema | Estado y criterio de cierre |
| --- | --- |
| Campos por ramo | Código y migración aditiva integrados y desplegados. Campos nuevos visibles; no afirmar que los datos históricos ya fueron convertidos. |
| Backfill de pólizas | Preview read-only integrado. Falta una conexión Production dedicada `policydesk_readonly`, generar y revisar el manifiesto por organización y luego ejecutar lotes auditables, repetibles y sin duplicados con aprobación del reporte. No se aplicó backfill. |
| Cotejo documental | La matriz de segunda pasada contiene 13 casos: 4 resueltos documentalmente y 9 parciales/pendientes. Un caso antes incompleto ahora cuenta con documento primario exacto; ese documento no confirma el pago. En seis casos de accidentes, los roles fueron confirmados por el usuario, pero las vigencias y coberturas siguen sin respaldo documental. Una consulta autenticada y de solo lectura en Production revisó otros tres registros de auto: devolvió datos de vigencia y pagos, pero uno presenta conflicto entre recibo cancelado y pago registrado. Esto no aporta la descripción del vehículo ni resuelve el backfill; los detalles identificables permanecen solo en el informe local. |
| Renovaciones / Operations | Código integrado y desplegado; flujos de seguimiento disponibles. La cartera de Insights aún necesita triage humano. |
| Operational Insights | Implementado y visible en Production; cuatro grupos, filtros y enlaces autenticados comprobados. Las señales visibles cambian con los datos y requieren atención operativa. |
| CI y despliegue | Run #464 SUCCESS en el head documental `b8d16e5`; Production READY en el merge documental `1613560`, con código de aplicación `cfd223e`. No hacer cambios de aplicación sin nueva certificación exact-SHA. |
| Restore remoto | Pendiente. Requiere validar artefacto, branch destino y PASS del restore CLI con conteos, FK, ciclos Payment, cancelación/renovación Policy/Receipt, Notifications, WorkItems, secuencias, lecturas de aplicación y Prisma drift. Mantener `RESTORE_DRILL_APP_SMOKE=0`. |
| DEMO privada | No se ha creado ni entregado usuario externo. Requiere cutover aprobado, aislamiento, login/cambio de contraseña, límites, reset/revocación y verificación escritorio/móvil. |
| Cutover | No aprobado ni realizado. Presentar evidencia y procedimiento concreto de recuperación antes de solicitar aprobación explícita. |

### Backfill: fuente documental

La nueva fuente documental permite resolver un caso que constaba como incompleto. En la matriz quedan 4 resueltos y 9 parciales/pendientes de 13. El documento acredita datos de vigencia/cobertura, pero no el pago. Las seis confirmaciones directas del usuario sobre los roles de contratante y asegurado no sustituyen los documentos faltantes de vigencia y cobertura. Una lectura autenticada y acotada de tres registros de auto en Production comprobó vigencias y pagos; uno requiere conciliación por discrepancia entre el recibo y el movimiento de pago. No se modificaron datos ni se aplicó backfill. Los identificadores y cifras de esos registros están solo en el informe local.

### Neon: procedencia y límites

No confundir estos proyectos:

- `policydesk-certification-20261001`: el par antiguo de ramas de certificación fue rechazado por su procedencia. No usarlo.
- `policydesk-insurance-drill-20261005`: proyecto temporal dedicado. `main` aparece vacío; la fuente `cert-stage3-132ada7c...` desciende de esa `main` y contiene marcador de fixture y migraciones esperadas. Se observaron dos filas BackupArtifact para una organización, tamaños 0 y 7003 bytes. El tamaño y metadatos no prueban que el backup sea íntegro ni recuperable.
- El destino `restore-drill-132ada7c-20261005` deriva de la fuente, expiraba el 2026-10-06 a las 14:17:58 según la consola local y aparecía Idle; la vista de tablas no permitió confirmar su estado vacío. Inspeccionar su estado actual antes de reutilizarlo.
- GitHub confirma que `132ada7c` está 22 commits detrás de Production `cfd223e`; esos cambios solo tocan documentos, CLI de backfill y pruebas de backfill. No cambian schema, migraciones ni código de backup/restore. El fixture podría reutilizarse si la procedencia/artefacto se valida y el destino pasa las comprobaciones con el código candidato.
- La contraseña del rol temporal de la rama hija se expuso en una salida anterior. Rotarla manualmente en Neon antes de conectar; no compartir la nueva clave. No se ha realizado restore remoto.
- La CLI Neon no está instalada en este host; un intento aislado con npm falló por resolución DNS. No usar variables compartidas Production/Preview ni secretos productivos.

### Procedimiento previo a un cutover

1. Verificar que el recurso es el proyecto de drill, la rama destino deriva de la fuente autorizada y contiene únicamente fixture sintético.
2. Rotar la credencial temporal expuesta; limitar cualquier credencial posterior al proyecto y recursos del drill. Revisar el alcance del runner antes de inyectarla.
3. Restaurar solo por CLI en una rama Neon temporal. Mantener intacta la fuente y `RESTORE_DRILL_APP_SMOKE=0`.
4. Exigir PASS del validador completo: conteos, FK, invariantes PolicyDesk/Payment, referencias Notification/WorkItem, secuencias, lecturas de aplicación, aislamiento y Prisma drift. Si falla, registrar FAIL y no conectar Production.
5. Presentar SHA, informe sanitizado, rama origen/destino y procedimiento de recuperación. El rollback a una rama temporal no equivale a rollback automático de Production.
6. Esperar aprobación explícita antes de cambiar variables productivas o hacer cutover. Tras aprobación, verificar clientes actuales y aislamiento; solo entonces provisionar una organización y usuario DEMO sintéticos.
7. Probar login/cambio de contraseña, límites, documentos sintéticos, reset, revocación y escritorio/móvil. Cerrar el flag de provisión y observar un ciclo de jobs antes de declarar `READY FOR EXTERNAL DEMO ACCESS`.

## Estados finales

- `READY FOR DAILY USE`: mejoras desplegadas, recorridos autenticados verificados y triage/backfill operativo acordado.
- `READY FOR EXTERNAL DEMO ACCESS`: restore/isolation/cutover aprobado; DEMO sintética y sus restricciones verificadas.

Ambos son independientes. Hoy Production tiene las mejoras desplegadas y la CI pasa, pero el manifiesto/backfill, triage documental, restore remoto y aceptación DEMO siguen pendientes. No archivar un chat fuente hasta cotejar su entrega con esta lista y adjuntar evidencia de cierre.
