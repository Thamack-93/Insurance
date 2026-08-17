# Runbook de disaster recovery de PolicyDesk

## Objetivo y ownership

Este procedimiento demuestra que un backup cifrado puede restaurarse y usarse en
una base temporal. No es un restore de producción ni una garantía contractual.
El owner operativo inicial es Pedro Gómez. La persona que autoriza la rama
temporal también debe aprobar su limpieza después de revisar el reporte.

Objetivos iniciales: RPO máximo de 24 horas mientras el backup diario termina
correctamente; RTO del drill de 60 minutos; frecuencia mensual hasta tres éxitos
consecutivos y trimestral después. Ejecutar además antes de eliminar Task, una
migración irreversible, un cambio del formato/clave de backup, un cambio mayor de
schema o un incidente de integridad.

## Prerrequisitos

- Acceso de administrador al repositorio y al store privado de Vercel Blob.
- Una rama temporal Neon ya provisionada por el operador; el código no crea,
  promueve ni elimina ramas.
- `DATABASE_URL` de la base fuente y `RESTORE_DATABASE_URL` del target temporal.
- `RESTORE_NEON_BRANCH` con prefijo permitido `restore-`, `preview-` o `temp-`.
- `ALLOW_TEMPORARY_NEON_RESTORE=true`.
- Si el rol administrado de Neon no permite `session_replication_role`, añade
  `ALLOW_NEON_USER_TRIGGER_FALLBACK=1` únicamente para este drill CLI. El fallback
  solo se activa en endpoints `*.neon.tech`, exige que todos los triggers de usuario
  estén en estado normal, deshabilita temporalmente los triggers dentro de la misma
  transacción, restaura las FKs cíclicas inventariadas y las vuelve a habilitar antes
  de validar. Nunca se configura en Vercel Runtime ni en la aplicación.
- La clave activa o la variable versionada correspondiente a la versión del
  backup (`BACKUP_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY_V2`, etc.).
- `BLOB_READ_WRITE_TOKEN` para leer el backup privado.

El target debe ser PostgreSQL temporal y su endpoint debe diferir de la fuente,
incluyendo sus variantes pooler/directas. Nunca uses una URL de producción.

## Elegir el backup

Selecciona un archivo reciente que el panel admin pueda verificar. La verificación
comprueba el manifiesto, tamaño, SHA-256, formato, clave y autenticación AES-GCM.
Eso es un preflight, no evidencia suficiente de recuperación: el drill debe pasar
conteos, FK, invariantes de pagos/pólizas/WorkItem y lecturas de aplicación.

## Ejecución

Provisiona la rama temporal y registra los fingerprints de origen y destino sin
guardar URLs completas. Ejecuta:

```bash
RESTORE_DATABASE_URL=... \
RESTORE_NEON_BRANCH=restore-2026-07-30 \
ALLOW_TEMPORARY_NEON_RESTORE=true \
npm run drill:backup:temp-neon -- <backup-filename.ndjson.gz.enc>
```

El drill aplica las migraciones actuales al target con un subprocess aislado,
restaura todas las tablas exportadas excepto `_prisma_migrations`, vuelve
`session_replication_role` a `origin` (o reestablece los triggers normales si se
usó el fallback), valida antes del commit y escribe un JSON en
`artifacts/restore-drills/`. El reporte incluye `triggerMode`. Un fallo revierte
toda la transacción.

Después del commit el propio drill reconecta al target, ejecuta las lecturas
mínimas, `check:legacy-workitem-refs -- --read-only` y `db:check-drift`. No
ejecutes el auditor apuntando a `DATABASE_URL` de producción durante este
procedimiento.

Salida esperada:

```text
Restore drill PASS. Reporte: artifacts/restore-drills/
Reporte: .../artifacts/restore-drills/<timestamp>-<backup>.json
```

Con `RESTORE_DRILL_APP_SMOKE=1` se crea un admin fixture efímero, se ejecutan los
smokes de login, Today, Clients, Policies, Receipts, Operations, Reports y Nora,
y se elimina el fixture al terminar. No se imprimen credenciales ni datos.

## Interpretar fallos

- `preflight`: autorización, branch, endpoint, conexión o migraciones.
- `backup-verification`: manifiesto, hash, formato, Blob o versión de clave.
- `insertion`: truncado o inserción SQL.
- `integrity`: conteos, schema, FK, lifecycle Payment, cancelación, renovación,
  WorkItem o secuencias.
- `post-commit-smoke`: lecturas, auditor legacy, drift de Prisma o Playwright.

El reporte contiene solo fingerprints, conteos, estados y un error sanitizado.
No incluir URLs, credenciales, claves, PII, nombres, emails, números de póliza,
valores monetarios ni stack traces.

## Key-version handling

Conserva cada clave anterior mientras exista un backup cifrado con ella. Para
rekey usa el flujo separado de `BACKUP_REKEY_ENABLED`; verifica las copias antes
de cambiar la versión activa. El restore selecciona la clave por `keyVersion` del
header/manifiesto y nunca imprime su valor.

## Checklist manual y cleanup

- [ ] Crear la rama Neon temporal fuera de la aplicación.
- [ ] Confirmar fingerprints de fuente y destino distintos.
- [ ] Elegir un backup reciente y verificado.
- [ ] Ejecutar el comando del drill.
- [ ] Revisar el JSON y su estado final.
- [ ] Confirmar conteos de tabla y total.
- [ ] Confirmar cero huérfanos FK.
- [ ] Confirmar invariantes de Payment, Policy, Receipt, Notification y WorkItem.
- [ ] Abrir PolicyDesk contra el target y recorrer pantallas críticas si procede.
- [ ] Confirmar que la fuente no cambió.
- [ ] Registrar duración/RTO.
- [ ] Obtener aprobación y eliminar manualmente la rama temporal.

Si el drill falla, conserva el reporte sanitizado, no promuevas la rama y corrige
la causa antes de repetirlo. La única operación de rollback del drill es el
rollback transaccional; la limpieza de Neon es una acción manual autorizada.

Un fallo `BACKUP_SCHEMA_INCOMPATIBLE` es fail-closed: el motor valida tablas y
columnas antes de truncar y no debe reintentarse con una copia que provenga de
un schema distinto. Genera un backup nuevo después de aplicar migraciones y
verifica que su versión sea compatible con el target temporal.

## Plantilla de resultados

Usa `docs/internal/restore-drill-results/README.md` como checklist de evidencia.
Adjunta el JSON sanitizado, registra el `failureCode` si aplica y anota el RTO
observado. Un reporte `PASS` requiere también lecturas de aplicación, auditoría
WorkItem, drift de Prisma y cleanup verificado cuando se habilitó Playwright.

Los artifacts sintéticos de CI se retienen 90 días; los reportes locales quedan
bajo control del operador y no se configuran en almacenamiento externo en este PR.
