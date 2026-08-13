# Contexto de organización autenticado

Esta slice introduce el contexto de organización para lecturas y escrituras de
clientes, lectura de pólizas, Today, búsquedas informativas de Nora y exportaciones. La selección se
guarda como una sugerencia firmada en `pd_session`; nunca sustituye la
revalidación de `OrganizationMembership` y `Organization` en PostgreSQL.

## Resolución

Las rutas server-side deben usar `requireOrganizationContext()` o
`requireOrganizationPortfolioReadScope()`. Cada usuario puede tener como máximo
una `OrganizationMembership`; la restricción existe físicamente en PostgreSQL y
la auditoría falla si detecta duplicados heredados. La única membership activa se
resuelve automáticamente. `/organization/select` queda únicamente como flujo
explícito para renovar una cookie cuya selección contradice esa membership; no
es un selector multi-organización.

Una organización inactiva bloquea el acceso inmediatamente. Una selección
obsoleta nunca cambia silenciosamente a otra. Un `SUPERADMIN` sin membership solo
puede usar `/platform` y no obtiene acceso operativo por su rol global.

## Slice migrada

- Today: métricas, recibos, renovaciones, tareas, actividad, alertas y riesgos.
- Clients: listado, búsqueda, detalle, alta, edición y exportación Excel.
- Users: Owner/Admin administran únicamente memberships y cuentas de su propia
  organización. La autorización se revalida y bloquea dentro de la misma
  transacción que escribe.
- Policies y endosos: listado, detalle, alta, edición, calidad, eliminación y
  captura PDF con relaciones validadas dentro de la organización y revalidación
  transaccional del contexto.
- Nora: búsquedas informativas y referencias autorizadas dentro de la
  organización seleccionada.

Los gates `check:tenant-read-scope` y `check:tenant-write-scope` impiden
introducir lecturas o writers de modelos protegidos sin `organizationId` o sin
pasar por un helper tenant autorizado. Los scripts operativos también fallan
cerradamente cuando no reciben una organización explícita.

El Excel incluye organización y timestamp, usa filename saneado, no se cachea y
escapa valores que podrían interpretarse como fórmulas.

## Panel master global

`SUPERADMIN` puede consultar `/platform` y el detalle
`/platform/organizations/[organizationId]`. El panel muestra agregados explícitos
por organización, memberships, último login de un miembro y actividad reciente
sin renderizar `oldValue` ni `newValue`. No crea organizaciones, no modifica
memberships y no concede acceso operativo: cualquier operación requiere una
membership activa y selección tenant explícita.

## Cobertura operativa ampliada

Receipts, payments, claims, quotes, insurers, documents, WorkItems/tasks,
risks, reports, commissions, data-quality, Telegram, imports, maintenance y
jobs usan alcance organizacional explícito. Los jobs enumeran organizaciones
activas y los scripts operativos requieren `--organization` o
`POLICYDESK_ORGANIZATION_ID`. El cutover productivo, billing y las mutaciones
del panel master permanecen como operaciones separadas y controladas.

## Retirada de singleton

No retirar el índice singleton, guard de eliminación, triggers ni sincronización
legacy de memberships hasta que todas las escrituras y lecturas estén
tenant-aware, la suite de dos organizaciones y el restore drill con dos
organizaciones pasen. La prueba local de aislamiento debe usar exclusivamente
PostgreSQL desechable con `TENANT_ISOLATION_TEST_DB=1` y
`PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1`.

## Fixture de separación de Pedro

El job `tenant-isolation` crea únicamente en su base desechable las organizaciones
`org_legacy_singleton_0001`, `org_pedro_gomez_0001` y
`org_demo_broker_0001`. La organización de Pedro usa el nombre
visible `Pedro Alfredo Gómez Lorenzo` y el slug
`pedro-alfredo-gomez-lorenzo`; `pedroagl93@gmail.com` recibe `OWNER` únicamente
en esa fixture. Demo contiene exclusivamente cuentas y registros sintéticos.
Esta identidad no se provisiona en Preview ni en producción
durante Cycle 2A. La creación productiva requiere completar los gates de
aislamiento y restore con dos organizaciones.
## Administrador global

`admin@policydesk.local` se provisiona mediante `npm run provision:platform-admin`.
El comando es preview por defecto; `--apply` requiere un target explícito y
una conexión directa. Si la cuenta no existe, la contraseña procede únicamente
de `PLATFORM_ADMIN_PASSWORD`. Un `SUPERADMIN` no tiene membership tenant,
no hereda acceso operativo y no puede promoverse mientras sea Owner o conserve
asignaciones operativas.
