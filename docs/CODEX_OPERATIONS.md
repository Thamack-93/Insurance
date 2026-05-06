# PolicyDesk Codex Operations

## Reglas principales

- Nunca editar directamente `data/policydesk.sqlite`.
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

## Consultas operativas

- Pagos proximos: `scripts/list-next-payments.ts`
- Renovaciones: `scripts/list-renewals.ts`
- Pendientes abiertos: `scripts/list-open-tasks.ts`
- Calidad de datos: `scripts/validate-data-quality.ts`

## Importaciones

Toda importacion debe:

- Validar con Zod.
- Soportar dry-run cuando sea viable.
- Crear backup antes de escribir.
- Imprimir reporte de cambios.
- Registrar ActivityLog si crea o actualiza entidades.

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

`data/backups/policydesk-YYYY-MM-DD-HH-mm.sqlite`

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

- `data/policydesk.sqlite`
- `data/documents`
- `data/backups` recientes
- Cualquier archivo de importacion o exportacion que sea parte de una operacion activa

## Checklist antes de cambios grandes

- Revisar `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`.
- Ejecutar backup.
- Entender relaciones afectadas.
- Preferir scripts idempotentes.
- Validar datos despues.
