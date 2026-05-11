# Scripts Operativos de PolicyDesk

Este directorio contiene utilidades seguras para trabajo local-first con Prisma y SQLite.

## Reglas

- No editar `data/pg.sqlite` a mano.
- Usar siempre Prisma Client generado en `src/generated/prisma/client`.
- Crear backup antes de escrituras masivas.
- Los imports deben validar entrada y soportar `--dry-run` cuando sea viable.
- Los exports deben escribir en `data/exports`.
- La carpeta `/Users/pedrogomez/Desktop/Polizas Pedro/Clientes` es la fuente maestra de evidencia documental y se compara contra `data/pg.sqlite` antes de escribir.
- `Referidor` es una self-relation de `Client`; úsalo para cuentas agrupadoras o cuentas trabajadas por intermediarios.
- La conciliación de la carpeta maestra es read-only por defecto; solo `--apply` permite crear clientes nuevos después de revisar reportes.

## Flujo de cruce maestro

1. Dividir las carpetas top-level en shards balanceados por peso real de archivos.
2. Asignar cada shard a un auditor para revisión solo lectura.
3. Consolidar los manifiestos en un revisor independiente.
4. Clasificar cada hallazgo como `matched`, `folder-only`, `db-only` o `ambiguous`.

Reglas clave:

- `matched`: evidencia dura en carpeta y coincidencia exacta en DB.
- `folder-only`: evidencia dura o fuerte en carpeta sin coincidencia exacta en DB.
- `db-only`: coincidencia exacta en DB sin evidencia localizada en la carpeta.
- `ambiguous`: solo hay evidencia heurística o hay conflicto entre fuentes; requiere revisión manual.
- La carpeta top-level puede ser `Referidor`; el cliente real puede aparecer dentro de PDFs o subcarpetas y debe vincularse cuando la evidencia lo permita.
- No se modifica la carpeta maestra durante el cruce.

Evidencia:

- **Dura**: número de póliza, número de recibo, XML con etiquetas claras, PDF con texto legible y coincidencia exacta en DB.
- **Heurística**: nombre de carpeta, OCR parcial, alias, pistas de agrupación y texto incompleto.
- La evidencia dura manda; la heurística solo propone candidatos y no puede convertir un caso ambiguo en `matched`.

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
- `scripts/reconcile-master-folder.ts`
- `scripts/reconcile-four-sources.ts`
- `scripts/clean-four-source-fields.ts`
- `scripts/canonical-staging.ts`
- `scripts/canonical-ledger-clean.ts`

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
- Conciliar carpeta maestra: `npm run reconcile:master-folder`
- Conciliar shards concretos: `npm run reconcile:master-folder -- --folders "Folder A,Folder B,Folder C"`
- Cambiar base del reporte: `npm run reconcile:master-folder -- --out data/exports/master-folder-reconciliation-shard-a`
- Aplicar solo clientes nuevos revisados: `npm run reconcile:master-folder -- --apply`
- Cruce de 4 fuentes con workbook: `npm run reconcile:four-sources -- --out data/exports/four-source-reconciliation.xlsx`
- Limpieza confiable de campos sobre el workbook crudo: `npm run clean:four-source-fields -- --source data/exports/four-source-reconciliation-YYYY-MM-DD-HH-mm.xlsx`
- Materializar staging canónica: `npm run staging:build -- --source data/exports/four-source-field-cleaning-YYYY-MM-DD-HH-mm.xlsx`
- Aplicar decisiones humanas al staging: `npm run staging:apply -- --source data/exports/canonical-review-YYYY-MM-DD-HH-mm.xlsx`
- Primera limpia tipo base real: `npm run staging:clean`
- Limpieza canónica con fuente externa versionada: `npm run staging:clean:ledger`
- Regenerar explícitamente el mismo archivo para pruebas: `npm run staging:clean:ledger -- --allow-duplicate`
- Generar el pack limpio de revisión por excepciones: `npm run staging:review-pack`

## Flags soportados

- `--dry-run` en `import-client.ts`, `import-policy.ts` y `seed-demo-data.ts`
- `--file` para imports
- `--days` para ventanas temporales
- `--limit` para recortes en consola
- `--folder` para cambiar la carpeta raíz completa
- `--folders` para limitar la conciliación a una lista de carpetas top-level separadas por coma
- `--out` para elegir el nombre/base del reporte
- `--apply` en `reconcile-master-folder.ts` para crear solo clientes nuevos cuando el reporte ya fue revisado
- `--source` en `staging:build` y `staging:apply` para apuntar a un workbook específico
- `--source` en `staging:clean:ledger` para apuntar a una fuente tabular externa distinta
- `--allow-duplicate` en `staging:clean:ledger` solo para reruns explícitos; sin este flag el mismo hash falla con reporte
- `staging:review-pack` lee el último batch completado de staging y genera un workbook de excepciones solamente, pensado para aprobación humana rápida

## Salidas del reconciliador

El comando `reconcile-master-folder.ts` escribe por defecto en `data/exports`:

- JSON con el detalle de archivos, candidatos y contadores.
- MD con resumen operativo y cola de revisión.
- CSV de pólizas coincidentes.
- CSV de pólizas faltantes en carpeta.
- CSV de candidatos de clientes nuevos.

Si usas `--folder`, cada auditor puede trabajar sobre su shard top-level sin tocar la carpeta maestra completa. El revisor une esos reportes y decide qué se importa, qué queda pendiente y qué se marca como `Referidor`.

## Base canónica de trabajo

- `data/pg.sqlite` sigue siendo intocable.
- `data/staging/canonical.sqlite` es la base canónica temporal para limpieza y revisión.
- El workbook de revisión es la interfaz humana para editar `decision humana`, `valor humano` y `nota humana`.
- Después de revisar, corre `npm run staging:apply` para persistir las decisiones en staging.
- `npm run staging:clean` crea tablas `canonical_*` sin duplicados por fuente y exporta `canonical-clean-first-pass-YYYY-MM-DD-HH-mm.xlsx`.
- `npm run staging:clean:ledger` crea una limpia más estricta desde `Fuente externa`: capa operativa actual, histórico buscable, pagos candidatos, ajustes/endosos como evidencia, diff contra corrida anterior y `Promotion preview` sin escribir en `data/pg.sqlite`.
- `staging:clean:ledger` crea backup de `data/staging/canonical.sqlite` antes de regenerar batches.
- Si faltan columnas esperadas o el mismo archivo ya fue procesado, `staging:clean:ledger` falla con un workbook `canonical-ledger-error-YYYY-MM-DD-HH-mm.xlsx`.
- `npm run staging:review-pack` genera una vista de revisión compacta con una sola hoja maestra de excepciones y un resumen corto; no altera la base real.

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
- `data/pg.sqlite` es la unica base activa del repositorio.
- Si una carpeta agrupa expedientes de terceros, el report debe asignar `Referidor` al cliente agrupador y no asumir que el folder principal es el asegurado final.
