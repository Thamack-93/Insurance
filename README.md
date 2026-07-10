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
- Vercel AI Gateway
- Vercel Blob privado

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
| `CRON_SECRET` | Producción | Protege los jobs internos de Telegram y del backup automatizado |
| `AI_GATEWAY_MODEL` | Opcional | Modelo `provider/model` usado por Nora |
| `AI_GATEWAY_API_KEY` | Opcional | Credencial principal para AI Gateway; OIDC queda como respaldo |
| `BLOB_READ_WRITE_TOKEN` | Producción | Acceso al store privado de Vercel Blob |
| `BACKUP_ENCRYPTION_KEY` | Producción | Clave de 32 bytes para AES-256-GCM |
| `BACKUP_ENCRYPTION_KEY_VERSION` | Producción | Versión activa de la clave de cifrado |
| `ENABLE_DOCUMENT_FILES` | Opcional | `false` para la demo publicada sin archivos |
| `AUTH_SECRET` | Dev | Alias de `SESSION_SECRET` en desarrollo |

## Comandos

```bash
npm install
npm run db:migrate
npm run dev
```

Scripts operativos:

```bash
npm run validate-data
npm run list:payments
npm run list:renewals
npm run list:work-items
npm run export:due-payments
npm run export:commissions
```

La restauración nunca se ejecuta desde la UI. Para una rama temporal de Neon:

```bash
RESTORE_DATABASE_URL=... RESTORE_NEON_BRANCH=restore-prueba \
ALLOW_TEMPORARY_NEON_RESTORE=true \
npm run restore:backup:temp-neon -- <archivo.ndjson.gz.enc>
```

## Flujo de desarrollo

1. Crear y verificar un backup cifrado desde el panel admin antes de cambios masivos.
2. Usar Prisma o scripts dedicados sobre una rama temporal de Neon.
3. Validar con lint, typecheck, tests y build; nunca ejecutar seeds sobre la base actual.

## Despliegue demo

La ruta recomendada para una demo pública o compartida es:

1. Crear una base de datos hosted.
2. Migrar el snapshot real actual a esa base hosted.
3. Configurar `DATABASE_URL` en el entorno de Vercel.
4. Desplegar en [Vercel Hobby](https://vercel.com/pricing).
5. Conectar un store privado de Blob para los backups cifrados.

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
