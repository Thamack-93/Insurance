# PolicyDesk en Vercel Hobby

## Objetivo

Desplegar PolicyDesk como demo funcional en Vercel Hobby usando Postgres hosted y sin PDFs en la primera versión.

## Stack recomendado

- Hosting: [Vercel Hobby](https://vercel.com/pricing)
- Base de datos: [Supabase Free](https://supabase.com/pricing)

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

- Subida y descarga de PDFs
- Almacenamiento local de documentos en runtime
- Backups/restauraciones SQLite locales en el demo publicado

## Variables de entorno

- `SESSION_SECRET`
- `DATABASE_URL`
- `ENABLE_DOCUMENT_FILES=false`
- `ENABLE_LOCAL_BACKUPS=false`
- `BACKUP_JOB_SECRET` solo si vas a usar el job local o un cron externo

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Cargar el snapshot real actual de `data/pg.sqlite` en la base hosted.
3. Configurar las variables de entorno en Vercel.
4. Desplegar la rama principal.
5. Verificar dashboard, hoy y CRUD principal.

## Validaciones mínimas

- La app no debe leer `data/pg.sqlite` en producción.
- No debe intentar escribir archivos PDF en runtime.
- `Document` debe operar solo como metadata en esta fase.
- Los flujos de backup locales deben quedar ocultos o deshabilitados.
