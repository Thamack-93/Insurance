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
- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_API_KEY` como credencial principal para AI Gateway
- `BLOB_READ_WRITE_TOKEN`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_ENCRYPTION_KEY_VERSION`

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Crear una rama protegida para preview; no seedear ni resetear la base actual.
3. Configurar las variables de entorno en Vercel.
4. Conectar un Blob store privado.
5. Dejar Vercel Cron como único programador de Telegram y del backup automatizado.
6. Desplegar preview, validar y luego promover la rama principal.

## Validaciones mínimas

- La app no debe resetear, truncar ni seedear la base actual.
- No debe intentar escribir archivos PDF en runtime.
- `Document` debe operar solo como metadata en esta fase.
- Los backups deben poder crearse, listarse y verificarse solo por admin.
