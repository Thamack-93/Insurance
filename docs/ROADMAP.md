# PolicyDesk Roadmap

## Fase 0: Plan maestro

Objetivo: dejar documentado el producto completo antes de codificar.

Definition of Done:

- `PRODUCT_AND_ARCHITECTURE_PLAN.md` existe.
- Arquitectura, data model, UI system y operacion Codex estan documentados.
- Roadmap Fase 0 a Fase 8 esta claro.
- MVP y fuera de scope estan definidos.

## Fase 1: Fundacion MVP

Objetivo: crear la app local, schema, seed, layout premium, Dashboard y Hoy.

Entregables:

- Next.js + TypeScript + Tailwind + shadcn/ui.
- Prisma + SQLite en `data/pg.sqlite`.
- Seed demo realista.
- Layout con sidebar y topbar.
- Dashboard operativo.
- Vista Hoy.
- Scripts base.

Definition of Done:

- `npm run dev` corre sin errores.
- `npm run db:migrate` funciona.
- `npm run db:seed` funciona.
- KPIs y Hoy usan datos reales de SQLite.

## Fase 2: Core CRM

Objetivo: construir entidades base navegables.

Entregables:

- Clientes, aseguradoras, polizas, recibos, pendientes y la self-relation de `Referidor`.
- Listados con TanStack Table.
- Detail pages.
- Formularios con React Hook Form + Zod.

Definition of Done:

- CRUD base estable.
- Relaciones visibles.
- ActivityLog para eventos importantes.

## Fase 3: Operacion diaria

Objetivo: hacer accionables vencimientos, renovaciones y tareas.

Entregables:

- `/due-payments`
- `/renewals`
- `/tasks`
- Filtros, drawers y acciones rapidas.

Definition of Done:

- Vistas proximos 60 dias correctas.
- Navegacion cliente/poliza funcional.
- Filtros principales funcionales.

## Fase 4: Finanzas y reportes

Objetivo: completar comisiones, cartera y exportaciones.

Entregables:

- `/commissions`
- `/reports`
- CSV/Excel si viable.
- Metricas de cartera.

Definition of Done:

- Comisiones esperadas, pendientes, cobradas y vencidas visibles.
- Reportes principales exportan.

## Fase 5: Document center

Objetivo: documentos locales seguros.

Entregables:

- Upload local.
- Asociaciones.
- Preview/descarga.
- Rename/delete con confirmacion.

Definition of Done:

- Nada sensible vive en `public`.
- Documentos faltantes detectables.

## Fase 6: Riesgos y calidad

Objetivo: sistema de alertas y calidad de datos.

Entregables:

- Risk engine.
- Data quality.
- Timeline enriquecido.
- Script de validacion.

Definition of Done:

- Alertas accionables.
- Scores de completitud.
- Validacion por script.

## Fase 7: Polish premium

Objetivo: elevar UX y productividad.

Entregables:

- Command palette.
- Favoritos.
- Recently viewed.
- Bulk actions.
- Dark mode opcional.
- Microinteracciones.

Definition of Done:

- La app se siente como cockpit premium.
- Navegacion rapida y fluida.

## Fase 8: Expansion futura

Objetivo: preparar crecimiento sin romper el core local.

Entregables:

- Preparacion cloud.
- Preparacion IA.
- Restore avanzado.
- Empaquetado Mac evaluado.

Definition of Done:

- Cloud e IA pueden agregarse sin reescribir el MVP.
