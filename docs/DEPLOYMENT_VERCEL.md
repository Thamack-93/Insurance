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

- Restauración de backups desde la UI; la restauración solo se permite por CLI hacia una rama temporal de Neon.

## Variables de entorno

- `SESSION_SECRET`
- `DATABASE_URL`
- `ENABLE_DOCUMENT_FILES=false`
- `CRON_SECRET`
- `UPSTASH_REDIS_REST_URL` opcional para rate limiting distribuido
- `UPSTASH_REDIS_REST_TOKEN` opcional para rate limiting distribuido
- `REQUIRE_DISTRIBUTED_RATE_LIMIT=0` mientras el proyecto tenga un único usuario
- `SECURITY_EVENT_FINGERPRINT_SECRET`
- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_FALLBACK_MODELS`
- `AI_GATEWAY_STRUCTURED_MODEL`
- `AI_GATEWAY_STRUCTURED_FALLBACK_MODELS`
- `AI_GATEWAY_API_KEY` como credencial principal para AI Gateway
- `BLOB_READ_WRITE_TOKEN`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_ENCRYPTION_KEY_VERSION`

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Crear una rama protegida para preview; no seedear ni resetear la base actual.
3. Configurar las variables de entorno en Vercel.
4. Conectar un Blob store privado.
5. Mantener los tres cron diarios en Vercel: `/api/jobs/backup` a las `05:00 UTC`, `/api/jobs/telegram-digest` a las `14:00 UTC` (08:00, hora de Ciudad de México) y `/api/jobs/telegram-birthdays` a las `15:00 UTC` (09:00, hora de Ciudad de México). El aviso de cumpleaños se deduplica por usuario y fecha local; el reenvío manual es independiente.
6. Mantener el fallback local de rate limiting para el despliegue actual. Cuando aumente el tráfico, configurar Redis y cambiar `REQUIRE_DISTRIBUTED_RATE_LIMIT=1` para fallar cerrado si Redis no está disponible.
7. Desplegar preview, validar y luego promover la rama principal.

## Validaciones mínimas

- La app no debe resetear, truncar ni seedear la base actual.
- No debe intentar escribir archivos PDF en runtime.
- `Document` debe operar solo como metadata en esta fase.
- Los backups deben poder crearse, listarse y verificarse solo por admin.
