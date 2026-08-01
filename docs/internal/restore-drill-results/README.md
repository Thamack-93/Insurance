# Restore drill evidence

Los JSON generados por el drill se guardan localmente en
`artifacts/restore-drills/` y se suben como artifact de CI con retención de 90
días. Este directorio contiene únicamente la plantilla y no debe almacenar
backups, URLs, credenciales, claves, PII o copias de producción.

Para cada ejecución documenta en el PR o ticket:

- `finalStatus`, `failureStage` y `failureCode`;
- timestamp, duración y fingerprint no reversible del target;
- conteos por tabla, total y tablas omitidas explícitamente;
- cero huérfanos FK y checks de dominio en estado correcto;
- resultado de lecturas de aplicación, auditor WorkItem y drift;
- si se habilitó el smoke Playwright, resultado del fixture y cleanup;
- RTO observado y aprobación para eliminar la rama temporal.

Un `PASS` criptográfico sin este reporte no constituye evidencia de recuperación.
