# Superadmin global y plataforma

`User.platformRole` es una frontera global independiente de `User.role` y de
`OrganizationMembership.role`. Los valores permitidos son `NONE` y
`SUPERADMIN`; la autorización se revalida contra la base en cada request.

## Provisionamiento

El script idempotente no crea memberships para el superadmin:

```bash
npm run provision:platform-admin -- --json
ALLOW_PLATFORM_ADMIN_PROVISION=1 \
PLATFORM_ADMIN_PASSWORD='<secreto efímero del operador>' \
npm run provision:platform-admin -- --apply --json
```

El secreto nunca se guarda en migraciones, fixtures ni logs. El script usa la
conexión administrativa directa `DATABASE_URL_UNPOOLED`. La barrera Cycle 1
excluye a `SUPERADMIN` de la sincronización legacy de memberships.

## Panel

`/platform` y `/platform/organizations/[organizationId]` requieren
`SUPERADMIN`. El panel solo gestiona ciclo de vida, memberships, suscripciones,
cargos y auditoría. No expone edición de clientes, pólizas, recibos ni pagos.
MRR y cobros se agregan por moneda sin conversión FX.

Las páginas operativas deben llamar `requireOrganizationMembership` con el
`organizationId` explícito; ser SUPERADMIN no sustituye esa membresía ni
permite omitir filtros tenant.

## Separación de Pedro

La organización `org_pedro_gomez_0001` no se crea durante Cycle 1. El script
preparado exige que se hayan retirado los guards singleton y dos autorizaciones
explícitas:

```bash
npm run split:pedro-organization -- --json
ALLOW_MULTI_ORG_TRANSITION=1 ALLOW_PEDRO_ORGANIZATION_SPLIT=1 \
npm run split:pedro-organization -- --apply --json
```

El modo apply es transaccional e idempotente. Mueve cartera de Pedro y filas
creadas por él sin conflicto; los conflictos se persisten en
`OrganizationMigrationConflict` para revisión y provocan rollback ante nulidad
tenant o inconsistencia. No debe ejecutarse hasta completar los gates de
contexto, escrituras, aislamiento y restore con dos organizaciones.
