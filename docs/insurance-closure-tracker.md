# Insurance closure tracker

Última actualización: 2026-10-05. Inventario consolidado para este chat y los chats fuente.

## Alcance y chats fuente

| Chat | Thread | Entrega transferida |
| --- | --- | --- |
| Coordina los chats del proyecto | 01a0f61d-4183-7480-b783-b034e027858a | Coordinación y goal completo |
| Add vehicle descriptions to policies | 01a0f5e6-2b9f-72c1-90d7-6df71043b287 | Cotejo documental y backfill por organización |
| Audit Demo organization support | 01a0f587-a833-7f81-a2ff-110a3f089bdd | Soporte de una organización DEMO y revisión productiva |
| Audit PolicyDesk demo sandbox | 01a0adb3-f260-76d0-8acc-4dac70465893 | Restore temporal Neon y aislamiento |
| Certify PolicyDesk demo access | 01a0c49b-0147-79c3-9b14-57063e8f8c2f | Certificación de cuenta DEMO privada |
| Corrige seguimiento de renovaciones | 01a0fe42-c8bf-7223-9601-1b8a3cd7a4e1 | Renovaciones y pendientes operativos |

## Evidencia actual

- PR #73 (campos de riesgo), PR #74 (tarjetas de renovación), PR #76 (E2E de renovaciones/PDF) y PR #78 (backfill auditable) están integrados.
- SHA de código Production/certificado al 2026-10-05: `132ada7c40d160d7ffeb0c7a242b48574d975d12` (merge PR #78). Es una referencia inmutable del candidato; `main` puede avanzar al integrar documentación u otros commits.
- Release Certification #38 [terminó SUCCESS](https://github.com/Thamack-93/Insurance/actions/runs/37337535025) en el SHA integrado exacto: quality, tenant/RLS, integración de aplicación, API, E2E y reporte sanitizado pasaron. El verificador de estado productivo fue omitido.
- Vercel Production está `READY` con el mismo SHA en `dpl_2pyGvbzqQbKH9Pyy2xR6ez2rE9ms`, alias `policypete.vercel.app`.
- En revisión autenticada de solo lectura cargaron Insights, el tablero de renovaciones de Operations y el editor WorkItem. No se guardaron datos. Las señales de Production son métricas operativas, no resultados sintéticos de DEMO.
- No hay cuenta DEMO externa creada ni conversaciones fuente archivadas.

## Pendientes y criterios de cierre

| Tema | Criterio de cierre | Estado |
| --- | --- | --- |
| Campos por ramo y backfill | Convertir por organización; conservar texto fuente; revisar ambiguos; reportar lotes auditables, repetibles y sin duplicados; validar PDF, renovación y edición asistida | Release Certification #38 pasa el backfill en PostgreSQL desechable. La matriz documental del chat de pólizas cubre 263 pólizas; registra 67 sin descripción de bien y 13 casos en su segunda pasada: 3 resueltos documentalmente y 10 aún parciales/pendientes. Esa matriz no es el manifiesto de conversión por organización. El CLI actual exige guardas de base desechable incluso para `dry-run`, por lo que no permite generar el reporte productivo requerido; falta una vía de preview estrictamente read-only y manifiesto revisado. No aplicar cambios en Production sin checkpoint y permiso específico. |
| Renovaciones y Operations | Alta/vinculación cierra seguimientos en transacción; reprogramar/quitar seguimientos y editar/cancelar tareas preservando identidad y permisos | Implementado; Release Certification #38 pasa en SHA integrado y el flujo de renovación cargó en Production en revisión autenticada de solo lectura. |
| Operational Insights | Cuatro grupos, filtros, agrupación, paginación, aislamiento y enlaces a acciones existentes | Implementado; la ruta autenticada cargó en Production en revisión de solo lectura. |
| CI / Vercel | Certificación exacta de quality, API, browser, aislamiento/RLS y restore desechable; deployment Production listo en el mismo SHA | Release Certification #38 SUCCESS en `132ada7c40d160d7ffeb0c7a242b48574d975d12`; Vercel Production READY en ese mismo SHA (`dpl_2pyGvbzqQbKH9Pyy2xR6ez2rE9ms`). El verificador productivo del workflow se omitió; la inspección manual fue de solo lectura y limitada a las rutas anotadas. |
| Restore remoto Neon | Fuente sintética de procedencia aprobada; fixture/backup; restore CLI temporal; conteos, FK, ciclos Payment, cancelación/renovación Policy/Receipt, Notifications, WorkItems, secuencias, lecturas, aislamiento y drift; `RESTORE_DRILL_APP_SMOKE=0` | **Pendiente.** El par hallado para `132ada7` nace de `main` del proyecto `policydesk-certification-20261001`; se rechaza como evidencia porque el runbook prohíbe usar/clonar `main` y una vista sin tablas no demuestra toda la procedencia. No ejecutar migración, fixture, backup ni restore en ese par. Vence el 2026-10-12; el proyecto estaba en 9/10 slots. Se necesita una fuente vacía aprobada y un par temporal nuevo para el SHA exacto. |
| DEMO privada | Tras cutover aprobado: una org sintética, un usuario temporal, login/cambio de contraseña, restricciones, reset, revocación, escritorio/móvil y cierre del flag de provisión | No lista; no provisionar ni compartir credenciales. |
| Cutover y recuperación | Evidencia, destino temporal compatible, responsables y pasos comprobados; aprobación explícita antes de Production | No aprobado. No cambiar la base o variables productivas ni reconectar la aplicación. |

## Próximas acciones

1. Aprobar una fuente de procedencia vacía que no clone la rama `main`; el par actual queda intacto y fuera del drill. Revisar cómo obtener un nuevo par temporal sin exceder el límite de ramas.
2. Revisar el alcance del runner remoto antes de configurar credenciales. La inyección temporal debe limitarse al recurso Neon y Blob privado del drill; no usar secretos ni backup de Production.
3. Solo entonces aplicar migraciones, tenant fixture restringido y seed CUSTOMER sintético; crear el backup por organización y restaurarlo por CLI. Revisar el PASS con todas las invariantes.
4. Presentar evidencia y recuperación concreta antes de solicitar aprobación del cutover.
5. Tras aprobación, probar aislamiento productivo y solo entonces provisionar la DEMO privada.
6. Revisar la matriz documental y ejecutar el proceso de backfill por organización de manera independiente.
7. Archivar cada chat fuente solo después de cotejar su entrega y adjuntar evidencia de cierre.

## Procedimiento de recuperación a presentar antes del cutover

- Responsable: el coordinador reúne evidencia; el operador con acceso a Neon/Vercel ejecuta las operaciones; el usuario aprueba cualquier reconexión de la aplicación productiva.
- Destino del drill: **pendiente de reasignar**. La rama temporal que deriva de `main` no es válida y no se debe usar. Antes de ejecutar, registrar branch ID, parent aprobado, SHA y huella sanitizada. Nunca restaurar en Production.
- Ante fallo: mantener mantenimiento, pausar/drenar jobs de negocio, registrar SHA e instante y preservar intacta la rama fuente.
- Usar únicamente un backup de una organización CUSTOMER sintética y una clave exclusiva del drill después de validar la fuente. DEMO está excluida de backups globales. No exponer backup real ni clave de Production al runner.
- Restaurar solo por CLI a la rama destino identificada. Pasar URL admin directa solo al paso migración/restore y URL pooled restringida solo a las validaciones que la necesiten.
- Exigir conteos, FKs públicas, ciclos Payment POSTED/REVERSED, cancelación/renovación Policy/Receipt, referencias Notification, WorkItem canónicas y heredadas, secuencias, lecturas, aislamiento tenant y Prisma drift. Mantener `RESTORE_DRILL_APP_SMOKE=0`.
- Si falla una invariante: marcar FAIL, mantener la aplicación cerrada y no reconectar Production. Si pasa, presentar reporte sanitizado, rama destino, huella, proyecto/entorno Vercel, SHA y comandos de verificación.
- Solo después de aprobación explícita, el operador puede cambiar las variables autorizadas del runtime/admin hacia un destino compatible, desplegar el SHA revisado y validar health, recorridos autenticados, aislamiento y jobs. Conservar la rama anterior durante la ventana acordada.

Este procedimiento describe una recuperación preparada, no un rollback automático. Tras un cutover multi-org no reconectar la aplicación singleton anterior: recuperar y certificar un destino compatible con multi-org.
