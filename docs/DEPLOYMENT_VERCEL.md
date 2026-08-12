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
- `DATABASE_URL` (endpoint pooled del rol restringido `policydesk_runtime`)
- `EXPECTED_DATABASE_ENV`
- `EXPECTED_DATABASE_FINGERPRINT`
- `EXPECTED_DATABASE_ROLE=policydesk_runtime`
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
- `RESTORE_DATABASE_URL`, `RESTORE_NEON_BRANCH`, `RESTORE_EXPECTED_DATABASE_ENV`, `RESTORE_EXPECTED_DATABASE_FINGERPRINT` y `ALLOW_TEMPORARY_NEON_RESTORE` solo para operaciones CLI autorizadas fuera de Vercel

`DATABASE_URL_UNPOOLED`, `DATABASE_RUNTIME_URL` y `NEON_API_KEY` pertenecen al
GitHub Environment protegido o a la sesión explícita del operador. No deben
existir en Production Runtime ni Preview de Vercel.

## Binding entre deployment y base

Cada base contiene una única fila `DeploymentIdentity`, local al entorno. La
aplicación compara esa fila con `EXPECTED_DATABASE_ENV` y
`EXPECTED_DATABASE_FINGERPRINT` antes de autenticación, escrituras y efectos
externos. Si falta o no coincide, login, dashboard, crons, Telegram y backups
fallan cerradamente con estado no disponible; `/api/health` no expone el
fingerprint ni la URL.

En destinos remotos, el CLI usa `NEON_API_KEY` para verificar project, branch,
endpoint `read_write`, database y protección de Production. El fingerprint se
deriva exclusivamente del project ID, branch ID y database ID devueltos por
Neon; los flags son expectativas que deben coincidir. Si Neon no responde, el
comando falla cerrado. Solo development/test sobre loopback admite identidad
local. Después de aplicar la migración por el endpoint directo, un operador
ejecuta primero el preview y luego el apply explícito:

El cutover productivo inicial usa `--topology-only` antes de cualquier mutación.
Ese modo verifica la topología mediante Neon API, deriva el fingerprint y no
consulta ni escribe `DeploymentIdentity`. En Neon Free, el workflow exige la
confirmación exacta `ACCEPT_UNPROTECTED_NEON_FREE_PRODUCTION` y limita
`ALLOW_UNPROTECTED_PRODUCTION_ON_NEON_FREE=1` al runner protegido. Solo después
crea una recovery branch no protegida, ejecuta `prisma migrate deploy`,
inicializa la identidad y provisiona `policydesk_runtime`.

En Neon Free, donde la consola no permite proteger Production, se admiten dos
excepciones separadas. La preparación de Preview requiere
`ALLOW_UNPROTECTED_PRODUCTION_REFERENCE_FOR_PREVIEW=1`, sigue verificando por
API ambos endpoints, branch IDs y database IDs, y rechaza cualquier fingerprint
igual a Production. El release productivo exige adicionalmente aprobación del
Environment, la frase exacta del workflow y
`ALLOW_UNPROTECTED_PRODUCTION_ON_NEON_FREE=1` solo durante la verificación e
inicialización. Ninguna variable se configura en Vercel Runtime.

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

Para aplicar la excepción Preview de Neon Free, anteponer únicamente a los dos
comandos anteriores:

```bash
ALLOW_UNPROTECTED_PRODUCTION_REFERENCE_FOR_PREVIEW=1 \
npm run init:deployment-db-identity -- <mismos-argumentos-preview>
```

El apply usa una transacción con timeout, advisory lock, relectura bajo lock,
GUC administrativo y verificación final. No imprime URLs, tokens ni respuestas
del proveedor.

Una rama clonada de Production hereda su fila y queda bloqueada hasta ejecutar
el modo `--rebind-cloned-branch` con los IDs de Production y
`ALLOW_DEPLOYMENT_IDENTITY_REBIND=1`. El comando exige una conexión directa y
rechaza un branch ID o endpoint idéntico a Production. Las variables de Preview
se configuran con scope de la rama Git correspondiente, nunca globalmente.

Para la primera identidad de Production, revisar primero el modo preview y usar
el opt-in únicamente durante el apply:

```bash
ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1 \
ALLOW_UNPROTECTED_PRODUCTION_ON_NEON_FREE=1 \
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
npm run check:deployment-db-safety -- --runtime-only
DATABASE_URL_UNPOOLED=<admin-direct> npm run check:deployment-db-safety -- --admin
```

No se promueve un artifact de Preview a Production: Production se construye con
su propia configuración e identidad. `vercel-build` hace únicamente el audit
runtime read-only y `next build`; no ejecuta migraciones. Ni build,
`postinstall`, startup ni Preview automático migran o revinculan bases.

## Rol PostgreSQL de runtime

`npm run provision:database-runtime-role` muestra un preview y `--apply` crea el
rol fijo `policydesk_runtime`. Requiere `DATABASE_URL_UNPOOLED` admin directa y
`DATABASE_RUNTIME_URL` pooled del nuevo rol. El rol no puede crear schema/base,
truncar tablas, leer `_prisma_migrations` ni mutar `DeploymentIdentity`; sí puede
hacer CRUD sobre el inventario operativo y usar sus secuencias.

No se usan default grants amplios: podrían exponer por accidente una futura
tabla environment-local. Cada modelo se añade explícitamente a
`src/lib/database-runtime-access.ts`; CI falla ante modelos no clasificados y el
workflow vuelve a provisionar los grants después de migrar. Si un rol existente
tiene autoridad incompatible, el CLI falla cerrado y exige revisión manual.

## Releases protegidos

`main` tiene auto-deploy Git desactivado en `vercel.json`; Preview continúa
automático. En GitHub Free, configurar el Environment `production` con una única
regla de deployment branch `main` y los secretos administrativos de Neon,
Vercel, fingerprint esperado y la cuenta de smoke. Los workflows exigen
`github.actor == github.repository_owner` además de las confirmaciones exactas.
`RELEASE_GITHUB_TOKEN` debe tener solo lectura de checks y de la configuración
del Environment para comprobar físicamente la política exacta de `main`; no
reemplaza la restricción aplicada por GitHub.

El workflow `production-runtime-role-cutover.yml` convierte el deployment base
ya aprobado al rol restringido. Verifica primero la topología sin depender del
schema, crea una recovery branch no protegida compatible con Neon Free, aplica la migración aditiva,
inicializa la identidad, provisiona el rol y retira de Vercel las credenciales
owner/directas heredadas. Después construye el SHA base como candidato separado
y solo lo promueve tras smoke y logs en PASS.

`production-release.yml` exige SHA/checks exactos, verifica el baseline, crea
una recovery branch no protegida compatible con Neon Free, migra por la conexión admin, inicializa/audita
identidad, reaplica grants explícitos, construye con `vercel build`, crea un
candidato con `vercel deploy --prebuilt --skip-domain` y ejecuta login, Today,
Clients, logout y revisión de logs. El alias se promueve solo después del PASS;
si falla, nunca abandona el deployment restringido anterior. Las migraciones
deben haberse confirmado aditivas antes de iniciar.

La recovery branch se conserva. `production-recovery-cleanup.yml` solo la
elimina tras restore drill `PASS`, nueva aprobación del Environment y
coincidencia exacta con el artifact inmutable del release run.

## Flujo de despliegue

1. Crear la base de datos hosted.
2. Crear una rama protegida para preview; no seedear ni resetear la base actual.
3. Aplicar migraciones mediante una conexión admin directa fuera de Vercel, inicializar/revincular identidad, provisionar el rol runtime y ejecutar ambos audits.
4. Configurar en Vercel solo las cuatro variables runtime y, para Preview, por rama Git.
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
