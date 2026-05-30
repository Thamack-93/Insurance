# PolicyDesk

PolicyDesk es un CRM operativo para cartera de seguros, construido con Next.js App Router, Prisma y Postgres hosted.

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- PostgreSQL
- TanStack Table
- React Hook Form
- Zod
- date-fns
- Lucide
- Recharts
- Framer Motion

## Qué resuelve

- Clientes y aseguradoras
- Pólizas, vencimientos y renovaciones
- Recibos, pagos y comisiones
- WorkItems para seguimiento operativo
- Riesgos, auditoría y reportes
- Documentos como metadatos en esta etapa

## Variables de entorno

Copia `.env.example` a `.env.local` y ajusta los valores:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `SESSION_SECRET` | Producción | Secreto HMAC para cookies de sesión (mín. 32 caracteres) |
| `DATABASE_URL` | Producción | URL de Postgres hosted para el despliegue en Vercel |
| `BACKUP_JOB_SECRET` | Opcional | Token Bearer para `POST /api/jobs/backup` |
| `ENABLE_DOCUMENT_FILES` | Opcional | `false` para la demo publicada sin archivos |
| `ENABLE_LOCAL_BACKUPS` | Opcional | Control de visibilidad de la sección de respaldos |
| `AUTH_SECRET` | Dev | Alias de `SESSION_SECRET` en desarrollo |

## Comandos

```bash
npm install
npm run db:migrate
npm run dev
```

Scripts operativos:

```bash
npm run backup
npm run validate-data
npm run list:payments
npm run list:renewals
npm run list:work-items
npm run export:due-payments
npm run export:commissions
```

## Flujo de desarrollo

1. Ejecutar backup antes de cambios masivos.
2. Usar Prisma o scripts dedicados.
3. Validar con seed, lint y build.

## Despliegue demo

La ruta recomendada para una demo pública o compartida es:

1. Crear una base de datos hosted.
2. Migrar el snapshot real actual a esa base hosted.
3. Configurar `DATABASE_URL` en el entorno de Vercel.
4. Desplegar en [Vercel Hobby](https://vercel.com/pricing).
5. Mantener `ENABLE_DOCUMENT_FILES=false` para la primera versión.

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

## Documentación

- `docs/DEPLOYMENT_VERCEL.md`
