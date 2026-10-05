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
- `main` actual: `132ada7c40d160d7ffeb0c7a242b48574d975d12`.
- PR #78 tuvo quality, tenant-isolation y application exitosos en su head `707fa0ba...`; en el merge SHA se verificó quality. No hay certificación completa exacta de Release Certification para el SHA integrado.
- Vercel Production está `READY` con el mismo SHA en `dpl_2pyGvbzqQbKH9Pyy2xR6ez2rE9ms`, alias `policypete.vercel.app`.
- En revisión autenticada de solo lectura cargaron Insights, tablero de renovaciones de Operations y el editor WorkItem. No se guardaron datos. El conteo de señales de Production es operativo y no se debe presentar como resultado sintético de DEMO.
- No hay cuenta DEMO externa creada ni conversaciones fuente archivadas.

## Pendientes y criterios de cierre

| Tema | Criterio de cierre | Estado |
| --- | --- | --- |
| Campos por ramo y backfill | Convertir por organización; conservar texto fuente; revisar ambiguos; reportar lotes auditables, repetibles y sin duplicados; validar PDF, renovación y edición asistida | Código integrado y prueba desechable en CI. Falta cotejo documental y reporte por organización revisado. No aplicar en Production sin checkpoint/permiso específico. |
| Renovaciones y Operations | Alta/vinculación cierra seguimientos en transacción; reprogramar/quitar seguimientos y editar/cancelar tareas preservando identidad y permisos | Implementado y cubierto por pruebas integradas/E2E del candidato anterior. Confirmar en la certificación completa del SHA final antes de declarar cerrado. |
| Operational Insights | Cuatro grupos, filtros, agrupación, paginación, aislamiento y enlaces a acciones existentes | Implementado; ruta autenticada cargó en Production en revisión de solo lectura. |
| CI / Vercel | Certificación exacta de quality, API, browser, aislamiento/ RLS y restore; deployment Production listo en el mismo SHA | Production READY en `132ada7`. Falta Release Certification completa exacta del merge SHA. |
| Restore remoto Neon | Fuente sintética; fixture/backup sintéticos; restore CLI en rama temporal; conteos, FK, ciclos Payment, cancelación/renovación Policy/Receipt, Notifications, WorkItems, secuencias, lecturas, aislamiento y drift; `RESTORE_DRILL_APP_SMOKE=0` | Pareja temporal presente en `policydesk-certification-20261001`: `cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12` → `restore-cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12`. Parent de ambas: `main` del proyecto de certificación. Vencen 2026-10-12; 9/10 ramas ocupadas. Falta validar procedencia sintética y preparar runner aislado; sin migraciones, fixture, backup ni restore. |
| DEMO privada | Tras cutover aprobado: una org sintética, un usuario temporal, login/cambio de contraseña, restricciones, reset, revocación, escritorio/móvil y cierre del flag de provisión | No lista; no provisionar ni compartir credenciales. |
| Cutover y recuperación | Evidencia, destino temporal compatible, responsables y pasos comprobados; aprobación explícita antes de Production | No aprobado. No cambiar la base o variables productivas ni reconectar la aplicación. |

## Próximas acciones

1. Confirmar que el parent `main` del proyecto de certificación no contiene datos reales; preparar el fixture y backup con datos sintéticos solamente.
2. Revisar el alcance del runner remoto. Inyectar secretos temporales solo al paso necesario y limitarlos al proyecto/Blob del drill; no usar secretos ni backup de Production.
3. Ejecutar restore en la pareja ya creada y revisar el reporte PASS con todas las invariantes.
4. Presentar evidencia y recuperación concreta antes de solicitar aprobación del cutover.
5. Tras aprobación, probar aislamiento productivo y solo entonces provisionar la DEMO privada.
6. Revisar la matriz documental y ejecutar el proceso de backfill por organización de manera independiente.
7. Archivar cada chat fuente solo después de cotejar su entrega y adjuntar evidencia de cierre.

## Procedimiento de recuperación a presentar antes del cutover

- Responsable: el coordinador reúne evidencia; el operador con acceso a Neon/Vercel ejecuta las operaciones; el usuario aprueba cualquier reconexión de la aplicación productiva.
- Destino del drill: la rama temporal `restore-cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12` en el proyecto de certificación. Registrar branch ID, parent, SHA y huella sanitizada. Nunca restaurar en Production.
- Ante fallo: mantener mantenimiento, pausar/drenar jobs de negocio, registrar SHA e instante y preservar intacta la rama fuente.
- Usar únicamente una copia cifrada generada con datos sintéticos y clave exclusiva del drill. No exponer backup real ni clave de Production al runner.
- Restaurar solo por CLI a la rama destino identificada. Pasar URL admin directa solo al paso migración/restore y URL de lectura restringida solo a las validaciones que la necesiten.
- Exigir conteos, FKs públicas, ciclos Payment POSTED/REVERSED, cancelación/renovación Policy/Receipt, referencias Notification, WorkItem canónicas y heredadas, secuencias, lecturas, aislamiento tenant y Prisma drift. Mantener `RESTORE_DRILL_APP_SMOKE=0`.
- Si falla una invariante: marcar FAIL, mantener la aplicación cerrada y no reconectar Production. Si pasa, presentar reporte sanitizado, rama destino, huella, proyecto/entorno Vercel, SHA y comandos de verificación.
- Solo después de aprobación explícita, el operador puede cambiar las variables autorizadas del runtime/admin hacia un destino compatible, desplegar el SHA revisado y validar health, recorridos autenticados, aislamiento y jobs. Conservar la rama anterior durante la ventana acordada.

Este procedimiento describe una recuperación preparada, no un rollback automático. Tras un cutover multi-org no reconectar la aplicación singleton anterior: recuperar y certificar un destino compatible con multi-org.
