# Insurance release readiness

Última revisión: 2026-10-05.

## Estado actual

- **READY FOR DAILY USE:** pendiente. Falta completar y revisar el reporte por organización del backfill; no se ha aplicado la conversión productiva.
- **READY FOR EXTERNAL DEMO ACCESS:** no listo. Aún faltan un restore remoto que pruebe datos sintéticos en el SHA actual, el checkpoint de cutover, la aprobación productiva, el aislamiento multi-org en Production y la aceptación del usuario temporal.

## Candidato desplegado

- `main`: `132ada7c40d160d7ffeb0c7a242b48574d975d12` (merge PR #78).
- PR #78: sus checks de quality, tenant-isolation y application pasaron en el head `707fa0ba...`; en el merge SHA se verificó quality. No hay certificación completa exacta de Release Certification para `132ada7`.
- Vercel Production: `READY` con el mismo SHA; deployment `dpl_2pyGvbzqQbKH9Pyy2xR6ez2rE9ms`, alias `policypete.vercel.app`.
- Revisión autenticada de solo lectura: `/reports/insights`, Operations (tablero de renovaciones) y el editor de WorkItem cargaron en Production. No se guardaron cambios. Las señales de renovación de Production deben revisarse con el equipo de operación antes de usarlas como métricas de DEMO.

## DEMO simplificada

La implementación prevista sigue siendo una organización sintética, un usuario temporal y el seed existente en la URL actual. No se ha creado ni entregado la cuenta DEMO y el flag de provisión sigue pendiente de cierre. Después del cutover aprobado se comprobarán login, cambio de contraseña, restricciones, reset, revocación y escritorio/móvil.

## Restore remoto Neon

En el proyecto separado `policydesk-certification-20261001` (`morning-block-38616998`) están las ramas temporales `cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12` y `restore-cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12`. Ambas parten de la rama `main` de ese proyecto y expiran el 2026-10-12. Neon muestra 9 de 10 ramas en uso; no crear otra pareja.

No se ha aplicado migración ni fixture, ni se ha ejecutado backup/restore. Falta confirmar la procedencia sintética del contenido de origen y limitar el runner/secretos a esas ramas. **No usar un backup ni claves de Production para este drill.** Mantener `RESTORE_DRILL_APP_SMOKE=0`.

## Siguiente secuencia

1. Verificar que la fuente del drill solo contiene datos sintéticos y fijar fixture/backup sintéticos.
2. Revisar el job remoto y su aislamiento antes de inyectar secretos temporales.
3. Ejecutar restore CLI a la rama temporal autorizada para `132ada7`; exigir todos los conteos, FK, invariantes, secuencias, lecturas, aislamiento y drift.
4. Presentar reporte y procedimiento de recuperación; solicitar aprobación antes de tocar Production.
5. Tras aprobación, realizar cutover y verificar aislamiento antes de provisionar una organización DEMO y un usuario temporal.
6. Completar y revisar el reporte del backfill; mantener su aceptación independiente del acceso DEMO.

El restore local/deshechable de CI y el despliegue Production no sustituyen estas puertas. No archivar chats fuente hasta transferir y cerrar su entrega con evidencia. Fuente del inventario: [insurance-closure-tracker.md](insurance-closure-tracker.md).
