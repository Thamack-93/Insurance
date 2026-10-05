# Insurance closure tracker

Última actualización: 2026-10-05. Fuente consolidada para este chat y los chats fuente.

## Alcance y chats fuente

| Chat | Thread | Estado transferido |
| --- | --- | --- |
| Coordina los chats del proyecto | 01a0f61d-4183-7480-b783-b034e027858a | Coordinador y Goal activo |
| Add vehicle descriptions to policies | 01a0f5e6-2b9f-72c1-90d7-6df71043b287 | Cotejo documental de pólizas en curso; no escribir datos productivos sin revisar matriz |
| Audit Demo organization support | 01a0f587-a833-7f81-a2ff-110a3f089bdd | Actualizado con certificación y despliegue recientes |
| Audit PolicyDesk demo sandbox | 01a0adb3-f260-76d0-8acc-4dac70465893 | Auditoría DEMO y recuperación; actualizado con evidencia reciente |
| Certify PolicyDesk demo access | 01a0c49b-0147-79c3-9b14-57063e8f8c2f | Certificación de acceso DEMO; actualizado con evidencia reciente |
| Corrige seguimiento de renovaciones | 01a0fe42-c8bf-7223-9601-1b8a3cd7a4e1 | Trabajo de renovación transferido; revisar su entrega final antes de archivar |

## Evidencia confirmada

- PR #73 (campos por ramo y migración aditiva) y PR #74 (tarjetas de renovación) están integrados en main.
- PR #76 añade pruebas E2E de renovación AUTO y captura/confirmación de PDF sintético; merge SHA 6e3bcc59e898af0fee92888f484709c260b9d060.
- Release Certification run 37272600957 terminó SUCCESS en ese SHA: calidad, integración/API/E2E, aislamiento multi-org/RLS y backup/restore en PostgreSQL desechable pasaron. El verificador de estado Production se omitió por condición del workflow.
- Vercel Production deployment dpl_CYLWAiPwSi1RmXqEnfAyWpqLD43H está READY en el mismo SHA y conserva el alias policypete.vercel.app.
- Revisión autenticada de Production, solo lectura: cargaron /today, /reports/insights, una vista y edición de póliza y /policies/capture. No se guardó póliza ni se procesó un PDF real.

## Pendientes y criterios de cierre

| Tema | Criterio de cierre | Estado actual |
| --- | --- | --- |
| Campos de riesgo y backfill | Conversión completa por organización; conservar texto fuente, marcar ambiguos, reporte revisado, lotes auditables y repetibles; verificar PDF, renovación y edición asistida | Migración y prueba de backfill en PostgreSQL desechable pasan en CI. No hay reporte por organización revisado ni backfill productivo. Cotejo documental de la cartera sigue en curso. |
| Renovaciones y Operación | Crear/vincular renovación cierra seguimientos manuales y automáticos en transacción; reprogramar/quitar seguimientos y editar/cancelar tareas conservando identidad y permisos | Cobertura incluida en la certificación E2E exacta; verificar entrega del chat fuente antes de archivarlo. |
| Operational Insights | Cuatro grupos, filtros, agrupación accionable, paginación y aislamiento; despliegue y navegación autenticada | Implementado; CI exacto pasa y la ruta /reports/insights cargó en Production autenticado. |
| CI / Vercel | Calidad, API, browser, aislamiento y restore desechable pasan en SHA exacto; deployment Production READY | Cerrado para SHA 6e3bcc5. La verificación automatizada de estado productivo fue omitida; la revisión manual hecha fue de solo lectura y limitada a las rutas anotadas arriba. |
| Backup/restore remoto Neon | Drill CLI en ramas temporales autorizadas y ligadas al candidato; fixture sintético CUSTOMER; conteos, FK, invariantes, refs, secuencias, lecturas, aislamiento y drift; RESTORE_DRILL_APP_SMOKE=0 | Pendiente. Las ramas previamente preparadas corresponden a d9d5f25, no al candidato 6e3bcc5. Aún falta runner autorizado con Blob privado y credenciales limitadas a las ramas del drill. |
| DEMO privada | Una organización, un usuario temporal y el seed sintético existente en la URL actual; login/cambio de contraseña, restricciones, reset/revocación y flag de provisión cerrado | Sin cuenta externa provisionada. Cutover/RLS de Production y verificación de aislamiento siguen pendientes. |
| Acceso externo / recuperación | Presentar evidencia completa, procedimiento de recuperación y destino temporal; obtener aprobación explícita antes de cutover y acceso a prospectos | No aprobado ni listo. No tocar Production DB, crear cuenta DEMO ni entregar credenciales antes del checkpoint y aprobación. |

## Próximas acciones

1. Terminar la matriz documental de la cartera contra los documentos fuente y revisarla antes de cualquier escritura.
2. Obtener aprobación específica para configurar un entorno temporal de GitHub Actions con Blob privado y credenciales limitadas a ramas Neon de certificación; generar una clave exclusiva dentro del runner.
3. Rehacer el par de ramas temporales para SHA 6e3bcc5, ejecutar el restore y documentar evidencia completa. El restore CI desechable no sustituye este drill.
4. Preparar y presentar el checkpoint de cutover con procedimiento de recuperación. Esperar aprobación explícita antes de tocar Production.
5. Después del cutover autorizado, provisionar una sola organización DEMO y un usuario temporal; verificar aislamiento, login, reset, revocación y apagar el flag.
6. Declarar por separado READY FOR DAILY USE y READY FOR EXTERNAL DEMO ACCESS solo cuando cada criterio tenga evidencia.

## Regla de archivo

No archivar chats fuente hasta que su entrega se haya cotejado, esté representada en esta lista y tenga evidencia de cierre.