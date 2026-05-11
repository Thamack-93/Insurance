# PolicyDesk Codex Operations

## Reglas principales

- Nunca editar directamente `data/pg.sqlite`.
- Usar Prisma o scripts dedicados.
- Antes de cambios masivos ejecutar `npm run backup`.
- No guardar documentos en `public`.
- No borrar documentos sin confirmacion o script dedicado.
- No ejecutar migraciones destructivas sin backup.
- No introducir cloud ni IA en el MVP.

## Scripts esperados

- `npm run backup`
- `npm run clean:cache`
- `npm run clean:artifacts`
- `npm run validate-data`
- `npm run export:due-payments`
- `npm run export:commissions`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run reconcile:master-folder`
- `npm run reconcile:four-sources`
- `npm run clean:four-source-fields`
- `npm run staging:build`
- `npm run staging:apply`
- `npm run staging:clean`
- `npm run staging:clean:ledger`
- `npm run staging:review-pack`

## Consultas operativas

- Pagos proximos: `scripts/list-next-payments.ts`
- Renovaciones: `scripts/list-renewals.ts`
- Pendientes abiertos: `scripts/list-open-tasks.ts`
- Calidad de datos: `scripts/validate-data-quality.ts`
- Conciliacion de carpeta maestra: `scripts/reconcile-master-folder.ts`
- Cruce de 4 fuentes: `scripts/reconcile-four-sources.ts`
- Limpieza de campos sobre workbook de cruces: `scripts/clean-four-source-fields.ts`

## Importaciones

Toda importacion debe:

- Validar con Zod.
- Soportar dry-run cuando sea viable.
- Crear backup antes de escribir.
- Imprimir reporte de cambios.
- Registrar ActivityLog si crea o actualiza entidades.
- La carpeta `/Users/pedrogomez/Desktop/Polizas Pedro/Clientes` es fuente maestra read-only; comparar siempre esa evidencia contra `pg.sqlite` antes de decidir altas o correcciones.
- `Referidor` es la self-relation de `Client` para agrupadores o intermediarios comerciales, y debe preservarse en la conciliacion.

## Cruce de carpeta maestra

La conciliacion de la carpeta maestra se hace en dos pasos:

1. **Planificacion de shards**: se divide el arbol top-level en shards balanceados por peso real de archivos, no por cantidad fija de carpetas.
2. **Reconciliacion y revision**: cada auditor trabaja solo lectura sobre su shard; el revisor consolida los manifiestos y cruza contra `pg.sqlite`.

Reglas operativas:

- Un shard es un conjunto de carpetas top-level balanceado por cantidad de archivos y evidencia.
- Los auditores no escriben en la DB; solo generan manifiestos y hallazgos.
- El revisor decide si un caso va a importacion, seguimiento manual o se queda clasificado como `folder-only` o `db-only`.
- La carpeta maestra nunca se modifica.

Interpretacion de estados:

| Estado | Significado |
| --- | --- |
| `matched` | Hay evidencia dura en carpeta y coincide con un registro exacto en `pg.sqlite`. |
| `folder-only` | Hay evidencia dura o fuerte en carpeta sin registro exacto en `pg.sqlite`. |
| `db-only` | Hay registro exacto en `pg.sqlite` sin evidencia localizada en la carpeta maestra. |
| `ambiguous` | Solo hay evidencia heuristica o hay conflicto entre fuentes; requiere revision manual. |

Regla de `Referidor`:

- La carpeta top-level puede representar al `Referidor` o agrupador comercial.
- El cliente real puede aparecer dentro de subcarpetas o dentro de un PDF, aunque no tenga carpeta propia.
- Si un documento revela un cliente referido, debe registrarse su relacion con `referidorId` cuando la evidencia lo soporte.
- Nunca forzar ciclos de referidor.

Evidencia:

- **Dura**: numero de poliza, numero de recibo, XML etiquetado, PDF con texto extraido legible y coincidencia exacta en DB.
- **Heuristica**: nombre de carpeta, OCR parcial, alias, texto incompleto y pistas de agrupacion.
- La evidencia dura manda; la heuristica solo propone candidatos y nunca debe sobrescribir un match exacto.

Como correr el cruce:

- Conciliacion completa en modo lectura: `npm run reconcile:master-folder`
- Conciliacion acotada a shards concretos: `npm run reconcile:master-folder -- --folders "Folder A,Folder B"`
- Personalizar salida de reporte: `npm run reconcile:master-folder -- --out data/exports/master-folder-reconciliation-shard-a`
- Aplicar solo clientes nuevos despues de revisar reportes: `npm run reconcile:master-folder -- --apply`
- Cruce total de revisar/fuente externa/master/DB: `npm run reconcile:four-sources -- --out data/exports/four-source-reconciliation.xlsx`
- Limpieza confiable sobre el workbook ya conciliado: `npm run clean:four-source-fields -- --source data/exports/four-source-reconciliation-YYYY-MM-DD-HH-mm.xlsx`
- Materializar staging canónica: `npm run staging:build -- --source data/exports/four-source-field-cleaning-YYYY-MM-DD-HH-mm.xlsx`
- Aplicar decisiones humanas al staging: `npm run staging:apply -- --source data/exports/canonical-review-YYYY-MM-DD-HH-mm.xlsx`
- Generar primera limpia como base real: `npm run staging:clean`
- Generar limpia versionada desde `Fuente externa`: `npm run staging:clean:ledger`
- Regenerar el mismo archivo solo de forma explícita: `npm run staging:clean:ledger -- --allow-duplicate`
- Generar el workbook de revisión limpio: `npm run staging:review-pack`

Salida esperada:

- JSON, MD y CSV en `data/exports`.
- Reporte de coincidencias de polizas.
- Cola de faltantes en carpeta.
- Cola de faltantes en DB.
- Candidatos de clientes nuevos con posible `Referidor`.
- Workbook `canonical-ledger-clean-YYYY-MM-DD-HH-mm.xlsx` con capa operativa, histórico buscable, pagos candidatos, ajustes/endosos, diff contra corrida anterior y promotion preview.
- Workbook `canonical-ledger-error-YYYY-MM-DD-HH-mm.xlsx` si la fuente externa cambia columnas o se intenta reprocesar el mismo hash sin permiso explícito.
- Workbook `canonical-review-pack-YYYY-MM-DD-HH-mm.xlsx` con una sola hoja de excepciones y resumen corto para aprobación rápida.

## Limpieza versionada con Fuente externa

Reglas:

- No exponer el nombre del sistema origen; usar la etiqueta visible `Fuente externa`.
- `data/pg.sqlite` no se escribe ni se migra durante este flujo.
- `Receipt` y `Payment` se separan: recibo es obligación, pago candidato es evento real.
- Pólizas y recibos conservan `primaNeta` y `primaTotal`.
- Canceladas principales no cuentan como cartera activa.
- Histórico importado es buscable, pero no operativo.
- Endosos e importes negativos son evidencia, no recibos operativos.
- Clientes similares y grupos sin serie/VIN quedan como sugerencias hasta aprobación humana.
- La promoción a DB real requiere aprobación explícita posterior.

## Exportaciones

Exportar a `data/exports`.

Reportes iniciales:

- Vencimientos.
- Comisiones.
- Renovaciones.
- Pendientes.
- Cartera.

## Backups

Formato:

`data/backups/pg-YYYY-MM-DD-HH-mm.sqlite`

Reglas:

- Backup manual desde settings.
- Backup por script.
- Backup antes de imports o deletes masivos.

## Cache hygiene

Estos comandos solo deben borrar artefactos regenerables:

- `npm run clean:cache`
- `npm run clean:artifacts`

Consecuencias esperadas:

- `next dev` recompila mas lento en la primera ejecucion despues de limpiar.
- Playwright puede volver a descargar browsers si se limpia su cache externa con el flag opcional `--playwright`.
- Los resultados de pruebas y los artefactos temporales desaparecen, pero no se toca la base ni los documentos.

Lo que queda prohibido tocar:

- `data/pg.sqlite`
- `data/staging/canonical.sqlite` puede existir como base de trabajo temporal y regenerable; nunca se trata como la base viva.
- `data/documents`
- `data/backups` recientes
- Cualquier archivo de importacion o exportacion que sea parte de una operacion activa

## Checklist antes de cambios grandes

- Revisar `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`.
- Ejecutar backup.
- Entender relaciones afectadas.
- Preferir scripts idempotentes.
- Validar datos despues.
