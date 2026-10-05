# Insurance release readiness

Última revisión: 2026-10-05.

## Estado

- READY FOR DAILY USE: pendiente de revisar/aprobar el reporte por organización del backfill completo y validar el flujo productivo correspondiente. No se ha aplicado el backfill.
- READY FOR EXTERNAL DEMO ACCESS: no listo. Falta restore remoto Neon ligado al SHA actual, checkpoint y aprobación del cutover, verificación de aislamiento productivo y aceptación de la cuenta temporal.

## Último candidato integrado

- SHA main: 6e3bcc59e898af0fee92888f484709c260b9d060.
- Release Certification run 37272600957: SUCCESS para calidad, integración/API/E2E, tenant isolation/RLS y restore en PostgreSQL desechable. La verificación automática del estado Production se omitió.
- Vercel Production deployment dpl_CYLWAiPwSi1RmXqEnfAyWpqLD43H: READY en ese SHA; alias policypete.vercel.app.
- Revisión autenticada de solo lectura en Production: /today, /reports/insights, vista/edición de póliza y /policies/capture cargaron. No se guardaron datos ni se usó un PDF real.

## Camino simplificado de DEMO

Cuando pasen las puertas de seguridad y se apruebe el cutover: usar una sola organización, un usuario temporal y el seed sintético existente en la URL actual. Probar login y cambio de contraseña, restricciones, reset y revocación; cerrar el flag de provisión. El backfill completo de pólizas conserva sus criterios originales.

## Pendientes de cierre

1. Revisar la matriz documental de la cartera y preparar/revisar el reporte de backfill por organización; ensayar repetición sin duplicados y verificar captura PDF, renovación y edición asistida.
2. Ejecutar restore CLI en ramas Neon temporales creadas para el SHA actual. Las ramas preparadas anteriormente corresponden a d9d5f25 y no sirven como evidencia del SHA 6e3bcc5.
3. Autorizar y configurar el entorno temporal de GitHub Actions, Blob privado y credenciales limitadas a las ramas de certificación. No usar secretos de Production; RESTORE_DRILL_APP_SMOKE=0.
4. Presentar el reporte Neon y procedimiento de recuperación antes de solicitar aprobación del cutover productivo.
5. Solo tras aprobación, ejecutar cutover/RLS, comprobar aislamiento y recorridos actuales, provisionar DEMO y verificar acceso, reset y revocación.

La fuente canónica del inventario y criterios es [insurance-closure-tracker.md](insurance-closure-tracker.md). El restore desechable de CI no equivale a un restore remoto Neon. No archivar chats fuente antes de cerrar sus entregas.