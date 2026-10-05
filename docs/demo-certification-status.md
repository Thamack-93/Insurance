# Insurance release readiness

Última revisión: 2026-10-05.

## Estado actual

- **READY FOR DAILY USE:** pendiente. Falta completar y revisar el reporte por organización del backfill; no se ha aplicado la conversión productiva.
- **READY FOR EXTERNAL DEMO ACCESS:** no listo. Aún faltan un restore remoto con datos sintéticos, el checkpoint de cutover, la aprobación productiva, el aislamiento multi-org en Production y la aceptación del usuario temporal.

## SHA de código desplegado

- Candidato de aplicación certificado: `132ada7c40d160d7ffeb0c7a242b48574d975d12` (Release Certification #38). Último merge de código verificado: `af608c709d5300a62fad0b1bfbb7a97f53561316` (PR #80; CLI read-only de backfill). La Production actual está READY para el merge SHA en `dpl_94n8Tnj5RfyN5P541NfCDxsG4ZYf`; este CLI no cambia el comportamiento runtime de la aplicación.
- Release Certification #38 [terminó SUCCESS](https://github.com/Thamack-93/Insurance/actions/runs/37337535025) sobre el candidato `132ada7c`: quality, tenant isolation/RLS, integración, API y E2E pasaron. CI #37346061761 pasó sobre el head exacto de PR #80, incluyendo la integración read-only/RLS con PostgreSQL desechable.
- Vercel Production: `READY` para el merge `af608c709d5300a62fad0b1bfbb7a97f53561316`; deployment `dpl_94n8Tnj5RfyN5P541NfCDxsG4ZYf`, alias `policypete.vercel.app`.
- Revisión autenticada de solo lectura: `/reports/insights`, Operations (tablero de renovaciones) y el editor de WorkItem cargaron en Production. No se guardaron cambios. Las señales de renovación de Production deben revisarse con el equipo de operación antes de usarlas como métricas de DEMO.

## Preview read-only de backfill\n\nEl CLI requiere `POLICY_RISK_BACKFILL_READONLY_DATABASE_URL` con el rol `policydesk_readonly`, no privilegiado y sin permisos de escritura. La integración CI #37346061761 comprobó que ve los registros del tenant bajo RLS. No se ha conectado a Production ni se ha producido el manifiesto; no sustituye la revisión del backfill o el permiso de aplicación.\n\n## DEMO simplificada

PR #80 ya publica el CLI `--production-preview` para generar una propuesta de backfill en una conexión estrictamente read-only y con RLS de organización; falta habilitar la conexión dedicada y revisar un manifiesto real. La implementación DEMO prevista sigue siendo una organización sintética, un usuario temporal y el seed existente en la URL actual. No se ha creado ni entregado la cuenta DEMO y el flag de provisión sigue pendiente de cierre. Después del cutover aprobado se comprobarán login, cambio de contraseña, restricciones, reset, revocación y escritorio/móvil.

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
