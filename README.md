# PolicyDesk

PolicyDesk es un CRM/dashboard local-first para operar una cartera de seguros desde Mac. El MVP funciona sin cloud, sin IA y con SQLite local.

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- SQLite
- TanStack Table
- React Hook Form
- Zod
- date-fns
- Lucide
- Recharts
- Framer Motion

## Estructura local

- Base de datos: `data/pg.sqlite`
- Backups: `data/backups`
- Documentos: `data/documents`
- Exportaciones: `data/exports`

Los documentos sensibles no se guardan en `public`.

## Comandos

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Scripts operativos:

```bash
npm run backup
npm run validate-data
npm run list:payments
npm run list:renewals
npm run list:tasks
npm run export:due-payments
npm run export:commissions
npm run reconcile:master-folder
```

## Flujo de desarrollo

1. Revisar `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`.
2. Ejecutar backup antes de cambios masivos.
3. Usar Prisma o scripts dedicados; nunca editar SQLite manualmente.
4. Validar con seed, lint y build.

## Cambios de schema (Prisma)

Toda modificación de `prisma/schema.prisma` debe acompañarse de su migración en el mismo commit. Nunca editar el schema sin generar la migración correspondiente.

```bash
# 1. Editar prisma/schema.prisma
# 2. Generar la migración
npx prisma migrate dev --name <descripcion_breve>
# 3. Verificar que no quede drift
npm run db:check-drift
```

`npm run db:check-drift` ejecuta `prisma migrate diff --exit-code` y falla si el schema define algo que ninguna migración crea. El script `scripts/post-merge.sh` lo corre automáticamente tras cada merge: si detecta drift aborta el merge y pide generar la migración faltante.

## Documentacion

- `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/UI_SYSTEM.md`
- `docs/CODEX_OPERATIONS.md`
- `docs/AI_ROADMAP.md`
