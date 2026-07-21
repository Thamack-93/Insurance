# Security P0: checklist de despliegue

## Configuración recomendada antes de producción

Configura en Vercel, separando Preview y Production:

- `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` para protección distribuida cuando haya más tráfico
- `REQUIRE_DISTRIBUTED_RATE_LIMIT=0` para el despliegue actual de un solo usuario
- `SECURITY_EVENT_FINGERPRINT_SECRET` con un secreto aleatorio dedicado
- `CRON_SECRET` para los jobs
- `TELEGRAM_WEBHOOK_SECRET` si Telegram está habilitado

Con `REQUIRE_DISTRIBUTED_RATE_LIMIT=0`, las rutas usan un límite local por instancia.
Es suficiente como medida temporal para el único usuario actual, pero no sustituye
la protección distribuida cuando existan varias instancias o tráfico público.
Al configurar Redis, cambia esta variable a `1` para fallar cerrado si Redis no está disponible.

## Base de datos

Aplicar las migraciones antes de promover la versión:

```bash
npx prisma migrate deploy
npm run check:legacy-workitem-refs
```

La migración crea agregados de eventos de seguridad y el índice único de
`TelegramWebhookUpdate.updateId`. No elimina datos.

## Firewall/WAF

En el proyecto de Vercel debe existir una política equivalente a:

| Ruta | Método | Regla sugerida |
| --- | --- | --- |
| `/login` (Server Action de autenticación) | `POST` | limitar por IP y permitir solo tráfico normal de navegador |
| `/api/integrations/telegram/webhook` | `POST` | permitir Telegram si hay lista de IP mantenida; conservar secret header |
| `/api/jobs/*` | `GET`/`POST` | permitir solo el scheduler con `CRON_SECRET` |
| `/api/nora/*`, `/api/policies/capture/*` | `POST` | WAF OWASP y límite estricto de payload/requests |

El Firewall complementa, pero no sustituye, la autenticación, same-origin,
validación de payload y rate limiting de la aplicación.

## Verificación post-release

1. Probar `GET /api/health` sin sesión.
2. Confirmar que `POST` JSON sin `Origin` recibe `403` en mutaciones protegidas.
3. Confirmar que un payload sobredimensionado recibe `413`.
4. Repetir el mismo `update_id` de Telegram y confirmar respuesta
   `{ "duplicate": true }` sin segundo efecto lateral.
5. Ejecutar el auditor Task -> WorkItem con conexión a staging.
6. Revisar que los agregados de seguridad agrupan repetición sin crear una
   alerta por cada intento.
