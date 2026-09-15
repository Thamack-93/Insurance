# Restore drill evidence

Los JSON generados por el drill se guardan localmente en
`artifacts/restore-drills/` y se suben como artifact de CI con retención de 90
días. Este directorio contiene únicamente la plantilla y no debe almacenar
backups, URLs, credenciales, claves, PII o copias de producción.

Para cada ejecución documenta en el PR o ticket:

- hashes sanitizados del manifiesto, payload cifrado y destino temporal;
- `finalStatus`, `failureStage` y `failureCode`;
- timestamp, duración y fingerprint no reversible del target;
- conteos por tabla, total y tablas omitidas explícitamente;
- cero huérfanos FK y checks de dominio en estado correcto;
- resultado de lecturas de aplicación, auditor WorkItem y drift;
- `fileRecovery`: referencias de documentos y evidencia de comisiones, separando blobs verificados, disponibles sin hash, faltantes, ilegibles y sin referencia;
- `fileRecoveryRequired`: `true` solo para paquetes `COMPLETE`; en paquetes `DATABASE_ONLY` la comprobación de archivos es informativa;
- `completeRecovery` (o `null` cuando no aplica por ser `DATABASE_ONLY`) y el estado de limpieza/aprobación de la rama temporal;
- si se habilitó el smoke Playwright, resultado del fixture y cleanup;
- RTO observado y aprobación para eliminar la rama temporal.

En un paquete `DATABASE_ONLY`, `finalStatus=PASS` acredita la recuperación de la
base y sus lecturas; no acredita la recuperación de archivos. Solo un paquete
`COMPLETE` con `fileRecovery.status=PASS` y `completeRecovery=true` acredita
recuperación completa. Un `PASS` criptográfico sin este reporte no constituye
evidencia de recuperación.
