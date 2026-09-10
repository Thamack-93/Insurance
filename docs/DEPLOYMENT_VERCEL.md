# PolicyDesk en Vercel Hobby

## Objetivo

Desplegar PolicyDesk en Vercel Hobby usando Neon Postgres, AI Gateway y Blob privado.

## Stack recomendado

- Hosting: [Vercel Hobby](https://vercel.com/pricing)
- Base de datos: Postgres hosted

## Qué entra en esta versión

- Dashboard
- Hoy
- Clientes
- Pólizas
- Recibos
- Pagos
- Comisiones
- Riesgos
- Reportes
- Configuración básica

## Qué queda fuera por ahora

- Restauración de backups desde la UI; la restauración y el restore drill solo se permiten por CLI hacia una rama temporal de Neon.

## Variables de entorno

- `SESSION_SECRET`
- `DATABASE_URL`
- `DATABASE_ADMIN_URL` solo para migraciones, cutover y operaciones de backup/restore fuera del runtime
- `PRODUCTION_READONLY_DATABASE_URL` y `PRODUCTION_READONLY_ROLE` para el verificador productivo
- `PRODUCTION_EXPECTED_TENANT_MODE` (`single-org` hasta completar cutover; después `multi-org`)
- `ENABLE_TENANT_RLS_CUTOVER=1` solo después del cutover RLS y verifier multi-org PASS
- `TENANT_RLS_APP_ROLE=policydesk_app` cuando se active el runtime
  multi-tenant; prepara `policydesk_app` y `policydesk_platform_owner` con
  `npm run prepare:tenant-roles` sobre `DATABASE_ADMIN_URL` antes del cutover
- `NEXT_PUBLIC_DOCUMENT_FILES_ENABLED=1` when private Blob uploads are ready
- `CRON_SECRET`
- `UPSTASH_REDIS_REST_URL` requerido en producción para rate limiting y locks
- `UPSTASH_REDIS_REST_TOKEN` requerido en producción para rate limiting y locks
- `REQUIRE_DISTRIBUTED_RATE_LIMIT=1` en producción (fallo cerrado)
- `SECURITY_EVENT_FINGERPRINT_SECRET`
- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_FALLBACK_MODELS`
- `AI_GATEWAY_STRUCTURED_MODEL`
- `AI_GATEWAY_STRUCTURED_FALLBACK_MODELS`
- `AI_GATEWAY_API_KEY` como credencial principal para AI Gateway
- `BLOB_READ_WRITE_TOKEN`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_ENCRYPTION_KEY_VERSION`
- `RESTORE_DATABASE_URL`, `RESTORE_NEON_BRANCH` y `ALLOW_TEMPORARY_NEON_RESTORE` solo para operaciones CLI autorizadas

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Crear una rama protegida para preview; no seedear ni resetear la base actual.
3. Configurar las variables de entorno en Vercel.
4. Conectar un Blob store privado y configurar `BLOB_READ_WRITE_TOKEN`; DEMO
   uploads require the private store and are automatically purged after 48 hours.
5. Mantener los cron diarios en Vercel, todos protegidos por `CRON_SECRET`:
   `/api/jobs/demo-retention` (04:30 UTC) purga Blob, resetea DEMO y suspende
   trials vencidos; `/api/jobs/backup` (05:00 UTC),
   `/api/jobs/nonpayment-cancellation` (06:00 UTC),
   `/api/jobs/renewal-followups` (13:30 UTC), `/api/jobs/telegram-digest`
   (14:00 UTC, 08:00 hora de Ciudad de México) y
   `/api/jobs/telegram-birthdays` (15:00 UTC, 09:00 hora de Ciudad de México).
   El aviso de cumpleaños se deduplica por usuario y fecha local; el reenvío
   manual es independiente.
6. Configurar Upstash Redis antes de habilitar usuarios DEMO. En producción la
   ausencia o caída de Redis bloquea rate limits y locks de forma fail-closed.
7. Desplegar preview, validar y luego integrar la rama principal. Vercel despliega
   `main` automáticamente.

### Migraciones productivas

El build de Vercel no ejecuta migraciones. Cuando un cambio incluya una migración:

1. CI y Preview deben estar verdes sobre el SHA que se integrará.
2. Crear y verificar un backup o una rama de recuperación cuando el cambio sea material.
3. Ejecutar `prisma migrate deploy` explícitamente contra la conexión directa de la
   rama productiva mediante una operación autorizada de Neon.
4. Confirmar `prisma migrate status`, drift cero y los audits aplicables.
5. Integrar a `main`; Vercel realizará el despliegue normal.

No guardar una conexión administrativa en Vercel y no ejecutar migraciones desde
`postinstall`, el build, el startup de la aplicación ni un Preview automático.

## Validaciones mínimas

- La app no debe resetear, truncar ni seedear la base actual.
- No debe intentar escribir archivos PDF en el filesystem efímero de Vercel.
- `Document` almacena metadata; el original se guarda en Blob privado y los
  originales DEMO expiran a las 48 horas.
- Los backups deben poder crearse, listarse y verificarse solo por admin.
- Un backup verificado criptográficamente no sustituye un restore drill. El drill sigue siendo CLI-only, hacia una rama temporal explícitamente autorizada y nunca hacia producción.

## Preview con contexto tenant

Cada Preview que valide `agent/authenticated-tenant-context` debe apuntar a una
rama Neon aislada, con `DATABASE_URL` pooled y `DATABASE_URL_UNPOOLED` directos
de la misma rama. No se ejecutan migraciones desde `postinstall`, build ni
startup. Antes del login, el operador debe comprobar que ambos hosts no son los
de producción, que pertenecen a la misma rama y que los cron, Telegram, email y
webhooks productivos están deshabilitados. El shell no carga búsqueda,
notificaciones ni Nora mientras no exista un contexto de organización válido.
