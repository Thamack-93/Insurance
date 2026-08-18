# Rollout de la organización de Pedro

Este runbook configura la organización bootstrap existente como la organización
de Pedro. No crea una segunda organización y no retira la barrera singleton.

## Preflight

Usar una conexión administrativa directa (`DATABASE_URL_UNPOOLED`) y confirmar
antes de cualquier `--apply`:

- Cycle 1 migrado y backfilled;
- exactamente una organización;
- Pedro activo con `User.role=ADMIN` y membership `OWNER`;
- ningún usuario tenant adicional;
- cero filas tenant con `organizationId` nulo;
- tenant audit y guard audit en PASS;
- backup fresco y recovery branch disponible.

El script siempre falla cerradamente si la organización no es
`org_legacy_singleton_0001`, si Pedro no es el Owner actual o si encuentra otro
usuario tenant. No elimina usuarios ni mueve cartera.

Si Cycle 1 todavía está en `BOOTSTRAP`, primero debe ejecutarse el backfill
aprobado usando `LEGACY_ORGANIZATION_OWNER_EMAIL=pedroagl93@gmail.com`. El
trigger singleton no permite reasignar un Owner después de que la organización
está `ACTIVE`; no se debe desactivar el trigger para forzarlo.

## Preview

```bash
DATABASE_URL_UNPOOLED='...' \
PEDRO_ORGANIZATION_NAME='...' \
PEDRO_ORGANIZATION_SLUG='...' \
PEDRO_ORGANIZATION_TIME_ZONE='...' \
PEDRO_ORGANIZATION_CURRENCY='...' \
PEDRO_OWNER_EMAIL='pedroagl93@gmail.com' \
npm run configure:pedro-organization -- --json
```

Todos los valores de metadata son obligatorios; el script no tiene defaults
visibles de runtime. El preview es `REPEATABLE READ READ ONLY`, no adquiere
locks de escritura, no registra ActivityLog y devuelve metadata actual,
propuesta, cambios y `NOOP`/`READY`.

## Apply autorizado

Requiere conexión directa, un actor existente y un motivo:

```bash
ALLOW_PEDRO_ORGANIZATION_PRODUCTION=1 \
PEDRO_CUTOVER_ACTOR_USER_ID='...' \
PEDRO_CUTOVER_REASON='Configuración inicial de la organización personal' \
DATABASE_URL_UNPOOLED='...' \
npm run configure:pedro-organization -- --apply --json
```

El actor debe estar activo y tener `platformRole=SUPERADMIN`; una membership
`OWNER` o `ADMIN` no puede cambiar metadata global. El apply valida la auditoría
tenant y los guards antes de escribir.

El apply usa `SERIALIZABLE`, `lock_timeout=30s`, `statement_timeout=5min` y
advisory lock. Actualiza únicamente metadata de la organización y registra un
`ActivityLog` con los campos modificados y valores saneados, sin contraseñas,
URLs, correos del actor ni datos de cartera. Los cambios de metadata no
invalidan sesiones; la autorización se revalida en cada request.

## Guard contra regresiones

Ejecutar `npm run check:organization-metadata-hardcodes`. Permite referencias
técnicas en migraciones históricas, inventarios y fixtures, pero falla si un
nombre o slug visible de una organización aparece en runtime, UI, auth o
scripts operativos. También verifica que Platform, Settings y Today consumen
la organización desde la capa de consultas PostgreSQL.

## Resultados y reparación

- Error antes del commit: rollback transaccional completo.
- Deployment fallido: rollback del alias/deployment, nunca de la base.
- Migración válida con auditoría reparable: forward repair idempotente.
- Owner ajeno, usuario adicional, relación cross-tenant o posible pérdida:
  `BLOCKED`; no se ejecutan correcciones automáticas.
- Restore: solo en una rama Neon temporal autorizada. Nunca desde la aplicación
  sobre producción.

La invalidación de acceso se basa en la revalidación de User, membership y
Organization en cada request; el script no intenta modificar cookies existentes.

## Hardcode transitorio

El ID bootstrap permanece temporalmente porque la barrera Cycle 1 lo usa en sus
triggers. Su eliminación requiere otra migración y otro PR con pruebas de
triggers, restore y auditoría; no se editan migraciones históricas.
