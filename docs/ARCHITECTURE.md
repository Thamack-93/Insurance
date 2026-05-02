# PolicyDesk Architecture

## Principios

- Local-first.
- Database-first.
- Prisma-only database access.
- Secure local documents.
- Server-first rendering.
- Business logic shared between app and scripts.

## Carpetas

```txt
app/
  (dashboard)/
  api/
components/
  layout/
  dashboard/
  tables/
  forms/
  cards/
  charts/
  filters/
  drawers/
  empty-states/
  command/
  ui/
lib/
  db.ts
  dates.ts
  money.ts
  status.ts
  files.ts
  search.ts
  validations.ts
  dashboard-queries.ts
  backup.ts
  risk-engine.ts
prisma/
  schema.prisma
  seed.ts
data/
  policydesk.sqlite
  documents/
  backups/
  exports/
scripts/
docs/
```

## Data flow

Lecturas:

- Page Server Component.
- Query helper en `lib`.
- Prisma.
- Componentes visuales reciben datos ya formateados cuando conviene.

Mutaciones:

- Formulario client component.
- Server Action o route handler.
- Zod validation.
- Prisma write.
- ActivityLog.
- Revalidate path.

Documentos:

- Upload via `app/api/documents`.
- Guardar archivo en `data/documents`.
- Guardar metadata en `Document`.
- Descargar o previsualizar via route handler seguro.

Scripts:

- Ejecutar con `tsx`.
- Usar Prisma.
- Crear backup antes de cambios masivos.
- Imprimir resumen claro.

## Seguridad local

- Nunca guardar documentos en `public`.
- No exponer paths absolutos en UI innecesariamente.
- Backups con timestamp.
- Operaciones destructivas requieren confirmacion o script dedicado.
- Imports deben soportar dry-run y reporte.

## Performance

- Usar paginacion en tablas grandes.
- Crear indices para fechas, estados y relaciones.
- Mantener charts agregados desde queries dedicadas.
- Evitar cargar documentos completos salvo preview/descarga.

## Testing

- Unit tests para helpers de fechas, dinero, riesgo y calidad.
- Integration smoke para Prisma seed y scripts.
- Manual visual QA para dashboard, today, tablas y drawers.

