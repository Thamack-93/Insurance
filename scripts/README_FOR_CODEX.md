# Scripts Operativos de PolicyDesk

Este directorio contiene utilidades seguras para trabajo local-first con Prisma y SQLite.

## Reglas

- No editar `data/policydesk.sqlite` a mano.
- Usar siempre Prisma Client generado en `src/generated/prisma/client`.
- Crear backup antes de escrituras masivas.
- Los imports deben validar entrada y soportar `--dry-run` cuando sea viable.
- Los exports deben escribir en `data/exports`.

## Archivos

- `scripts/backup-db.ts`
- `scripts/list-next-payments.ts`
- `scripts/list-renewals.ts`
- `scripts/list-open-tasks.ts`
- `scripts/export-due-payments.ts`
- `scripts/export-commissions.ts`
- `scripts/validate-data-quality.ts`
- `scripts/seed-demo-data.ts`
- `scripts/import-client.ts`
- `scripts/import-policy.ts`

## Uso rapido

- Backup: `tsx scripts/backup-db.ts`
- Pagos proximos: `tsx scripts/list-next-payments.ts --days 30 --limit 20`
- Renovaciones: `tsx scripts/list-renewals.ts --days 60 --limit 20`
- Pendientes: `tsx scripts/list-open-tasks.ts --limit 30`
- Exportar pagos: `tsx scripts/export-due-payments.ts --days 60`
- Exportar comisiones: `tsx scripts/export-commissions.ts`
- Validar datos: `tsx scripts/validate-data-quality.ts`
- Seed demo: `tsx scripts/seed-demo-data.ts`
- Importar clientes: `tsx scripts/import-client.ts --file ruta/al/archivo.csv`
- Importar polizas: `tsx scripts/import-policy.ts --file ruta/al/archivo.xlsx`

## Flags soportados

- `--dry-run` en `import-client.ts`, `import-policy.ts` y `seed-demo-data.ts`
- `--file` para imports
- `--days` para ventanas temporales
- `--limit` para recortes en consola

## Flujo recomendado

1. Ejecutar backup.
2. Hacer import con `--dry-run`.
3. Revisar resumen y errores.
4. Repetir sin `--dry-run`.
5. Validar datos al final.

## Formatos de entrada

Los imports aceptan `csv`, `xlsx` o `json`.

### Clientes

Columnas utiles:

- `fullName` o `nombre`
- `type` o `tipo`
- `email` o `correo`
- `phone` o `telefono`
- `secondaryPhone` o `telefonoSecundario`
- `rfc`
- `address` o `direccion`
- `preferredContactMethod` o `metodoContacto`
- `notes` o `notas`
- `status` o `estado`

### Polizas

Columnas utiles:

- `policyNumber` o `numeroPoliza`
- `clientId`, `clienteId`, `client`, `cliente`, `clientName`, `clienteNombre`
- `insurerId`, `aseguradoraId`, `insurer`, `aseguradora`, `insurerName`, `aseguradoraNombre`
- `policyType` o `tipoPoliza`
- `status` o `estado`
- `startDate` o `fechaInicio`
- `endDate` o `fechaFin`
- `renewalDate` o `fechaRenovacion`
- `premiumAmount` o `prima`
- `currency` o `moneda`
- `paymentFrequency` o `frecuenciaPago`
- `paymentPlan` o `planPago`
- `insuredObject` o `objetoAsegurado`
- `beneficiaryInfo` o `beneficiarios`
- `notes` o `notas`

## Notas de seguridad

- Si un import encuentra duplicados o ambiguedades, debe detenerse para esa fila y reportarlo.
- Los scripts de exportacion nunca escriben sobre la base SQLite.
- `seed-demo-data.ts` recrea datos completos; usar solo cuando se desea resetear el entorno local.

