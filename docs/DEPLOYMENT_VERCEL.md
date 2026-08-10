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
- `DATABASE_URL_UNPOOLED` (endpoint directo; solo migraciones y comandos explícitos)
- `EXPECTED_DATABASE_ENV`
- `EXPECTED_DATABASE_FINGERPRINT`
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
- `RESTORE_DATABASE_URL`, `RESTORE_NEON_BRANCH`, `RESTORE_EXPECTED_DATABASE_ENV`, `RESTORE_EXPECTED_DATABASE_FINGERPRINT` y `ALLOW_TEMPORARY_NEON_RESTORE` solo para operaciones CLI autorizadas

## Binding entre deployment y base

Cada base contiene una única fila `DeploymentIdentity`, local al entorno. La
aplicación compara esa fila con `EXPECTED_DATABASE_ENV` y
`EXPECTED_DATABASE_FINGERPRINT` antes de autenticación, escrituras y efectos
externos. Si falta o no coincide, login, dashboard, crons, Telegram y backups
fallan cerradamente con estado no disponible; `/api/health` no expone el
fingerprint ni la URL.

El fingerprint se deriva de project ID, branch ID y database ID/nombre de Neon.
Nunca se acepta una cadena manual como prueba de identidad. Después de aplicar
la migración por el endpoint directo, un operador ejecuta primero el preview y
luego el apply explícito:

```bash
npm run init:deployment-db-identity -- \
  --environment preview \
  --project-id <neon-project-id> \
  --branch-id <neon-branch-id> \
  --database <database-id-o-nombre> \
  --endpoint-id <endpoint-id-directo> \
  --production-branch-id <production-branch-id> \
  --production-endpoint-id <production-endpoint-id>

npm run init:deployment-db-identity -- \
  --environment preview \
  --project-id <neon-project-id> \
  --branch-id <neon-branch-id> \
  --database <database-id-o-nombre> \
  --endpoint-id <endpoint-id-directo> \
  --production-branch-id <production-branch-id> \
  --production-endpoint-id <production-endpoint-id> \
  --apply
```

Una rama clonada de Production hereda su fila y queda bloqueada hasta ejecutar
el modo `--rebind-cloned-branch` con los IDs de Production y
`ALLOW_DEPLOYMENT_IDENTITY_REBIND=1`. El comando exige una conexión directa y
rechaza un branch ID o endpoint idéntico a Production. Las variables de Preview
se configuran con scope de la rama Git correspondiente, nunca globalmente.

Para la primera identidad de Production, revisar primero el modo preview y usar
el opt-in únicamente durante el apply:

```bash
ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1 \
npm run init:deployment-db-identity -- \
  --environment production \
  --project-id <neon-project-id> \
  --branch-id <production-branch-id> \
  --database <database-id-o-nombre> \
  --endpoint-id <production-endpoint-id> \
  --apply
```

Para una rama Preview clonada que heredó la identidad de Production:

```bash
ALLOW_DEPLOYMENT_IDENTITY_REBIND=1 \
npm run init:deployment-db-identity -- \
  --environment preview \
  --project-id <neon-project-id> \
  --branch-id <preview-branch-id> \
  --database <database-id-o-nombre> \
  --endpoint-id <preview-endpoint-id> \
  --production-branch-id <production-branch-id> \
  --production-endpoint-id <production-endpoint-id> \
  --rebind-cloned-branch \
  --apply
```

Antes de desplegar o migrar, y de nuevo después, ejecutar:

```bash
npm run check:deployment-db-safety
```

No se promueve un artifact de Preview a Production: Production se construye con
su propia configuración e identidad. El build de Production conserva el
`prisma migrate deploy` existente, pero ni el build, ni `postinstall`, ni el
arranque inicializan o revinculan la identidad; Preview tampoco migra de forma
automática.

En el primer rollout, aplicar esta migración administrativamente antes de
desplegar el código que exige la identidad, inicializar Production y ejecutar el
check. Así se evita una ventana de indisponibilidad entre `migrate deploy` y la
inicialización explícita.

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Crear una rama protegida para preview; no seedear ni resetear la base actual.
3. Aplicar migraciones mediante `DATABASE_URL_UNPOOLED`, inicializar o revincular la identidad y ejecutar el check saneado.
4. Configurar las variables por entorno y, para Preview, por rama Git en Vercel.
5. Conectar un Blob store privado.
6. Mantener los cinco cron diarios en Vercel, todos protegidos por `CRON_SECRET`: `/api/jobs/backup` a las `05:00 UTC`, `/api/jobs/nonpayment-cancellation` a las `06:00 UTC`, `/api/jobs/renewal-followups` a las `13:30 UTC`, `/api/jobs/telegram-digest` a las `14:00 UTC` (08:00, hora de Ciudad de México) y `/api/jobs/telegram-birthdays` a las `15:00 UTC` (09:00, hora de Ciudad de México). El aviso de cumpleaños se deduplica por usuario y fecha local; el reenvío manual es independiente.
7. Mantener el fallback local de rate limiting para el despliegue actual. Cuando aumente el tráfico, configurar Redis y cambiar `REQUIRE_DISTRIBUTED_RATE_LIMIT=1` para fallar cerrado si Redis no está disponible.
8. Desplegar Preview y Production como builds separados, validando la identidad exacta en cada uno.

## Validaciones mínimas

- La app no debe resetear, truncar ni seedear la base actual.
- Pooled y direct deben resolver la misma identidad y el check debe devolver `PASS`.
- `DeploymentIdentity` no se exporta ni se sobrescribe durante backup/restore; el target de restore se autoriza e inicializa por separado.
- Antes de invocar restore o drill, migrar la rama temporal e inicializar/revincular su identidad; el CLI nunca toma la identidad del backup y el app smoke recibe únicamente la identidad autorizada del target.
- No debe intentar escribir archivos PDF en runtime.
- `Document` debe operar solo como metadata en esta fase.
- Los backups deben poder crearse, listarse y verificarse solo por admin.
- Un backup verificado criptográficamente no sustituye un restore drill. El drill sigue siendo CLI-only, hacia una rama temporal explícitamente autorizada y nunca hacia producción.
