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
- Documentos y PDFs en almacenamiento privado de Vercel Blob, con metadatos y referencias protegidas

## Variables de entorno

Copia `.env.example` a `.env.local` y ajusta los valores:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `SESSION_SECRET` | Producción | Secreto HMAC para cookies de sesión (mín. 32 caracteres) |
| `DATABASE_URL` | Producción | URL de Postgres hosted para el despliegue en Vercel |
| `CRON_SECRET` | Producción | Protege los cuatro jobs internos de Vercel Cron |
| `AI_GATEWAY_MODEL` | Opcional | Modelo `provider/model` usado por Nora |
| `AI_GATEWAY_FALLBACK_MODELS` | Opcional | Modelos de respaldo para conversación |
| `AI_GATEWAY_STRUCTURED_MODEL` | Opcional | Modelo para acciones y salidas estructuradas |
| `AI_GATEWAY_STRUCTURED_FALLBACK_MODELS` | Opcional | Respaldo de acciones estructuradas |
| `AI_GATEWAY_API_KEY` | Opcional | Credencial principal para AI Gateway; OIDC queda como respaldo |
| `BLOB_READ_WRITE_TOKEN` | Producción | Acceso al store privado de Vercel Blob |
| `BACKUP_ENCRYPTION_KEY` | Producción | Clave de 32 bytes para AES-256-GCM |
| `BACKUP_ENCRYPTION_KEY_VERSION` | Producción | Versión activa de la clave de cifrado |
| `BACKUP_REKEY_ENABLED` | Producción, temporal | Activa la creación manual de copias re-cifradas (`true`) |
| `BACKUP_REKEY_TARGET_KEY_VERSION` | Producción, temporal | Versión de la clave nueva, distinta de la activa |
| `BACKUP_ENCRYPTION_KEY_V2` | Producción, temporal | Ejemplo de clave de 32 bytes para la versión `v2` |
| `ENABLE_DOCUMENT_FILES` | Opcional | `false` para la demo publicada sin archivos |
| `AUTH_SECRET` | Dev | Alias de `SESSION_SECRET` en desarrollo |
| `RESTORE_DRILL_APP_SMOKE` | Opcional | `1` habilita el smoke E2E opt-in contra el target temporal |
| `TENANT_ISOLATION_TEST_DB` | Solo tests | Debe ser `1` para habilitar fixtures de aislamiento desechables |
| `PLAYWRIGHT_ENFORCE_DISPOSABLE_DB` | Solo tests | Rechaza bases que no sean locales/desechables |

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

Para probar recuperación completa (conteos, foreign keys, invariantes, WorkItem,
lecturas y reporte JSON), el operador debe provisionar la rama temporal por separado:

```bash
RESTORE_DATABASE_URL=... RESTORE_NEON_BRANCH=restore-2026-07-30 \
ALLOW_TEMPORARY_NEON_RESTORE=true \
npm run drill:backup:temp-neon -- <archivo.ndjson.gz.enc>
```

El drill no crea, promueve ni elimina ramas Neon. La verificación criptográfica por sí
sola no demuestra recuperabilidad. Los reportes sanitizados se escriben en
`artifacts/restore-drills/` y nunca contienen URLs, credenciales ni datos de clientes.
Consulta el [runbook de disaster recovery](docs/internal/disaster-recovery-runbook.md)
para el procedimiento completo.

### Migrar una clave sin borrar backups

Para conservar backups cifrados con una clave anterior, no sustituyas la clave activa primero. Guarda una nueva clave de 32 bytes en un gestor seguro y configura temporalmente `BACKUP_ENCRYPTION_KEY_V2`, `BACKUP_REKEY_TARGET_KEY_VERSION=v2` y `BACKUP_REKEY_ENABLED=true` en Vercel. Desde Configuración → Respaldos, un administrador puede crear y verificar una copia de cada backup. Las copias se escriben en `database-backup-rekeys/`, no reemplazan los originales y quedan fuera de la retención automática.

Tras verificar y probar las copias que necesites restaurar, conserva también la clave anterior mientras existan originales que puedan necesitarse. Antes de cambiar la versión activa, guárdala además como `BACKUP_ENCRYPTION_KEY_V1` (sustituye `V1` por su versión real); así el restaurador puede seguir abriendo originales. Solo entonces desactiva `BACKUP_REKEY_ENABLED`; cambiar la clave activa es una operación posterior y separada.

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

La demo usa almacenamiento privado para PDFs/documentos; las rutas entregan referencias temporales autorizadas y nunca exponen el contenedor directamente.

## Nora Knowledge Reliability

La base de conocimiento de Nora separa fuentes `INTERNAL` por organización de fuentes `GENERAL` de plataforma. Las fuentes tenant se crean como `DRAFT`, se prueban únicamente desde el panel administrativo y solo una fuente `ACTIVE` por organización, aseguradora y producto puede participar en la recuperación. Activar una versión calcula un manifiesto SHA-256 ordenado de título, versión y chunks; cualquier cambio posterior invalida la integridad y devuelve la fuente a borrador.

Nora solo usa `searchActiveKnowledgeBase`, con vigencia por fecha calendario y zona horaria de la organización. Las preguntas contractuales exigen evidencia `INTERNAL`; si no existe evidencia íntegra y una cita derivada de aplicación, Nora se abstiene. `previewInternalKnowledgeSource` está reservado a `OWNER`/`ADMIN`. El seed de fuentes `GENERAL` es CLI-only (`npm run knowledge:seed-general`), y la auditoría/backfill son explícitos y de solo base desechable:

```bash
npm run check:knowledge-integrity
ALLOW_KNOWLEDGE_INTEGRITY_BACKFILL=1 npm run backfill:knowledge-integrity
```

La arquitectura, el ciclo de vida, las garantías de tenant, las citas, GMM, inyección y los límites operativos están documentados en [`docs/internal/nora-knowledge-reliability.md`](docs/internal/nora-knowledge-reliability.md).

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
- `docs/tenant-context.md`
