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

- Base de datos: `data/policydesk.sqlite`
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
```

## Flujo de desarrollo

1. Revisar `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`.
2. Ejecutar backup antes de cambios masivos.
3. Usar Prisma o scripts dedicados; nunca editar SQLite manualmente.
4. Validar con seed, lint y build.

## Documentacion

- `docs/PRODUCT_AND_ARCHITECTURE_PLAN.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/UI_SYSTEM.md`
- `docs/CODEX_OPERATIONS.md`
- `docs/AI_ROADMAP.md`

