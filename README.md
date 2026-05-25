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

## Variables de entorno

Copia `.env.example` a `.env.local` y ajusta los valores:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `SESSION_SECRET` | Producción | Secreto HMAC para cookies de sesión (mín. 32 caracteres) |
| `DATABASE_URL` | Producción | URL de Postgres hosted para el despliegue en Vercel |
| `BACKUP_JOB_SECRET` | Opcional | Token Bearer para `POST /api/jobs/backup` (cron externo) |
| `ENABLE_DOCUMENT_FILES` | Opcional | `false` para la demo desplegada sin PDFs |
| `ENABLE_LOCAL_BACKUPS` | Opcional | `false` para ocultar respaldos SQLite locales en la demo |
| `AUTH_SECRET` | Dev | Alias de `SESSION_SECRET` en desarrollo |

### Respaldo automático (cron)

La ruta `POST /api/jobs/backup` está exenta del middleware de sesión y solo acepta:

```bash
curl -X POST "http://localhost:5000/api/jobs/backup" \
  -H "Authorization: Bearer $BACKUP_JOB_SECRET"
```

Activa **Respaldo automático** en Configuración para que el job respete la frecuencia y retención configuradas.

## Comandos

```bash
npm install
npm run db:migrate
npm run dev
```

`npm run db:seed` queda solo para pruebas locales aisladas; no forma parte del despliegue hosted de esta versión.

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

1. Ejecutar backup antes de cambios masivos.
2. Usar Prisma o scripts dedicados; nunca editar SQLite manualmente.
3. Validar con seed, lint y build.

## Despliegue demo

La ruta recomendada para una demo pública o compartida es:

1. Crear una base gratuita de Postgres hosted.
2. Migrar el snapshot real actual de `data/pg.sqlite` a esa base hosted.
3. Configurar `DATABASE_URL` en el entorno de Vercel.
4. Desplegar en [Vercel Hobby](https://vercel.com/pricing).
5. Mantener `ENABLE_DOCUMENT_FILES=false` y `ENABLE_LOCAL_BACKUPS=false` para la primera versión.

La demo queda enfocada en datos estructurados y no requiere PDFs ni almacenamiento de archivos en esta fase.

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

- `docs/DEPLOYMENT_VERCEL.md`
