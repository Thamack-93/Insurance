# Insurance release readiness

Última revisión: 2026-10-05.

## Estado actual

- **READY FOR DAILY USE:** pendiente. Falta completar y revisar el reporte por organización del backfill; no se ha aplicado la conversión productiva.
- **READY FOR EXTERNAL DEMO ACCESS:** no listo. Aún faltan un restore remoto con datos sintéticos, el checkpoint de cutover, la aprobación productiva, el aislamiento multi-org en Production y la aceptación del usuario temporal.

## SHA de código desplegado

- SHA verificado al 2026-10-05: `132ada7c40d160d7ffeb0c7a242b48574d975d12` (merge PR #78). Este es el SHA del candidato de código certificado/desplegado en esta revisión; no implica que la rama `main` conserve ese SHA después de integrar documentación u otros commits.
- Release Certification #38 [terminó SUCCESS](https://github.com/Thamack-93/Insurance/actions/runs/37337535025) sobre ese SHA: quality, tenant isolation/RLS, integración, API y E2E pasaron. El verificador productivo fue omitido.
- Vercel Production: `READY` con el mismo SHA; deployment `dpl_2pyGvbzqQbKH9Pyy2xR6ez2rE9ms`, alias `policypete.vercel.app`.
- Revisión autenticada de solo lectura: `/reports/insights`, Operations (tablero de renovaciones) y el editor de WorkItem cargaron en Production. No se guardaron cambios. Las señales de renovación de Production deben revisarse con el equipo de operación antes de usarlas como métricas de DEMO.

## DEMO simplificada

La implementación prevista sigue siendo una organización sintética, un usuario temporal y el seed existente en la URL actual. No se ha creado ni entregado la cuenta DEMO y el flag de provisión sigue pendiente de cierre. Después del cutover aprobado se comprobarán login, cambio de contraseña, restricciones, reset, revocación y escritorio/móvil.

## Restore remoto Neon

En el proyecto separado `policydesk-certification-20261001` (`morning-block-38616998`) se encontraron estas ramas para `132ada7`: `cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12` y `restore-cert-stage3-132ada7c40d160d7ffeb0c7a242b48574d975d12`. Ambas nacen de la rama `main` del proyecto y expiran el 2026-10-12. Neon mostraba 9 de 10 slots ocupados al revisarlas.

**Este par queda rechazado como evidencia de certificación y no debe usarse:** el runbook prohíbe clonar `main` como fuente, y la observación anterior de que no aparecían tablas no prueba por sí sola la procedencia completa del estado de datos. No ejecutar migraciones, fixture, backup ni restore en esas dos ramas. Mantenerlas intactas.

El siguiente par debe originarse en una fuente cuyo estado vacío y procedencia estén aprobados explícitamente, sin depender de la rama `main` del proyecto de certificación; ligarlo al SHA exacto que se vaya a certificar. Antes del drill, hacer checkout de ese SHA inmutable y verificar que `git rev-parse HEAD` coincida con `CERTIFICATION_CANDIDATE_SHA` y el identificador de ambas ramas. El proyecto estaba a 9/10 ramas, por lo que no hay espacio para otra pareja allí. No crear un proyecto nuevo ni expandir secretos/permisos hasta revisar el alcance y autorización específicos.

No se ha ejecutado backup/restore remoto. **No usar backups ni claves de Production.** Mantener `RESTORE_DRILL_APP_SMOKE=0`.

## Siguiente secuencia

1. Conseguir una fuente Neon con procedencia vacía aprobada; rechazar el par ligado a `main`, y preparar un par temporal para el SHA exacto.
2. Revisar el job remoto y su aislamiento antes de inyectar secretos temporales.
3. Solo después de aprobar la fuente y el runner, ejecutar restore CLI al destino autorizado ligado al SHA exacto; exigir todos los conteos, FK, invariantes, secuencias, lecturas, aislamiento y drift.
4. Presentar reporte y procedimiento de recuperación; solicitar aprobación antes de tocar Production.
5. Tras aprobación, realizar cutover y verificar aislamiento antes de provisionar una organización DEMO y un usuario temporal.
6. Completar y revisar el reporte del backfill; mantener su aceptación independiente del acceso DEMO.

El restore local/deshechable de CI y el despliegue Production no sustituyen estas puertas. No archivar chats fuente hasta transferir y cerrar su entrega con evidencia. Fuente del inventario: [insurance-closure-tracker.md](insurance-closure-tracker.md).
