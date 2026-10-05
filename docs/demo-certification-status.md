# Insurance release readiness

Última revisión: **2026-10-05 UTC**  
Candidato integrado: `d9d5f25ae703133555a05a05646da5bbf04e84d7` (PR #74, encima de #73)

## Estado

- **READY FOR DAILY USE: pendiente.** El producto desplegado funciona en las pantallas revisadas, pero falta ensayar y revisar el reporte del backfill completo de pólizas.
- **READY FOR EXTERNAL DEMO ACCESS: no listo.** No hay usuario DEMO externo; el cutover multi-org/RLS sigue pendiente de su checkpoint y aprobación productiva.

Este resumen reemplaza el estado operativo obsoleto que sigue en el historial Git.

## Evidencia completada

| Área | Evidencia actual |
|---|---|
| Integración | PR #73 (campos por ramo) y PR #74 (tarjetas de renovación) fusionados. |
| Vercel | Production deployment `dpl_7LFeQs6ADGxo8DxzEvLaxNZJcawN` está READY en el SHA candidato. URL de la aplicación: [policypete.vercel.app](https://policypete.vercel.app). |
| CI | Release Certification [#33](https://github.com/Thamack-93/Insurance/actions/runs/37265745620) terminó con éxito para el SHA candidato. Pasaron calidad, aplicación/API/browser y aislamiento tenant/RLS; también pasó la integración de backup/restore en PostgreSQL desechable. |
| Production, solo lectura | El verificador devolvió `WARN` con cero incidencias inesperadas. Los avisos aceptados reflejan el modo actual single-org y RLS pendiente; el run no ejecutó cambios productivos. |
| Revisión visual | En Production autenticado cargaron Operación/renovaciones y `/reports/insights`, con grupos Renovaciones, Cobranza, Siniestros y Trabajo. No se editó ningún registro. |

La integración de restore de CI usa PostgreSQL desechable. No sustituye el drill remoto de Neon.

## Pendiente: backfill de pólizas

El script `scripts/backfill-policy-risk-details.ts` sigue dentro del alcance completo por organización. No se ha ejecutado en Production ni se ha revisado un reporte de conversión.

1. Ensayar la conversión en PostgreSQL desechable con organización explícita.
2. Revisar convertidas, ambiguas, errores y muestras; confirmar que se conserva el texto original y que repetir el lote no duplica datos.
3. Validar captura desde PDF, renovación y edición asistida; el CI actual no enlaza todavía explícitamente estos tres flujos a la persistencia de los campos nuevos.
4. Preparar después el backfill productivo por lotes. No aplicarlo hasta revisar y aprobar el reporte de la organización.

## Pendiente: backup/restore remoto

En Neon existe el proyecto temporal `policydesk-certification-20261001` (`morning-block-38616998`). Se verificaron estas ramas exactas del candidato; ambas expiran el 2026-10-11 y muestran 0 kB de almacenamiento:

- Fuente: `cert-stage3-d9d5f25ae703133555a05a05646da5bbf04e84d7` (`br-plain-bird-b7zs5e5y`).
- Destino: `restore-cert-stage3-d9d5f25ae703133555a05a05646da5bbf04e84d7` (`br-round-waterfall-b7grs9o8`).

No se ha comprobado allí una base migrada ni provisionado el fixture CUSTOMER sintético; tampoco se ha creado/verificado un artifact remoto o ejecutado restore. El Blob privado usado en un intento anterior no está disponible (su ID reportó 404); no hay un token activo confirmado para este drill.

La siguiente ejecución requiere autorización para crear un Blob privado dedicado y exponer a un entorno GitHub Actions credenciales limitadas a estas dos ramas y a ese Blob. No usar credenciales ni claves de Production. La clave del backup debe generarse solo durante el drill. Mantener `RESTORE_DRILL_APP_SMOKE=0`. PASS debe incluir conteos, FK, invariantes de pagos/pólizas, Notifications, WorkItems, secuencias, lecturas RLS, drift y auditoría multi-org.

## Pendiente: DEMO externa y cutover

Production sigue en modo single-org con barrera singleton y RLS deshabilitado; el verificador de solo lectura lo reporta como WARN esperado. No se ha ejecutado el cutover, provisionado cuenta DEMO ni cambiado datos de clientes en Production.

Antes de solicitar aprobación productiva, presentar el certificado remoto y un procedimiento concreto de recuperación que identifique responsable, backup, rama temporal y reconexión de la aplicación. Tras aprobar y completar cutover/isolation gates, el alcance DEMO es intencionalmente simple: **una organización, un usuario temporal y el seed sintético existente en la URL actual**. Probar login, cambio de contraseña, restricciones, reset y revocación; apagar el flag de provisión. Las credenciales se entregan solo al prospecto autorizado.

## Criterios de cierre

- **READY FOR DAILY USE:** backfill ensayado y reporte por organización revisado; integridad PDF/renovación/edición asistida verificada; despliegue y flujos diarios confirmados.
- **READY FOR EXTERNAL DEMO ACCESS:** drill Neon PASS; checkpoint y procedimiento de recuperación aprobados; cutover/RLS/aislamiento verificados; una cuenta temporal DEMO probada y revocable.

No archivar los chats fuente hasta que sus tareas transferidas tengan evidencia de cierre.