# Contexto de organización autenticado

Esta slice introduce el contexto de organización para lecturas y escrituras de
clientes, lectura de pólizas, Today, búsquedas informativas de Nora y exportaciones. La selección se
guarda como una sugerencia firmada en `pd_session`; nunca sustituye la
revalidación de `OrganizationMembership` y `Organization` en PostgreSQL.

## Resolución

Las rutas server-side deben usar `requireOrganizationContext()` o
`requireOrganizationPortfolioReadScope()`. Una membership activa se selecciona
automáticamente; con varias memberships se muestra `/organization/select`.
Una organización inactiva o una selección obsoleta no cambia silenciosamente a
otra: se requiere una nueva selección. Un `SUPERADMIN` sin membership solo puede
usar `/platform` y no obtiene acceso operativo sin contexto explícito.

## Slice migrada

- Today: métricas, recibos, renovaciones, tareas, actividad, alertas y riesgos.
- Clients: listado, búsqueda, detalle, alta, edición y exportación Excel.
- Policies: listado, detalle y relaciones defensivamente filtradas por
  organización. Las mutaciones de crear, editar, borrar y actualizar calidad
  están bloqueadas con `POLICY_TENANT_MUTATION_PENDING` hasta Cycle 2B.
- Nora: búsquedas informativas y referencias autorizadas dentro de la
  organización seleccionada.

El Excel incluye organización y timestamp, usa filename saneado, no se cachea y
escapa valores que podrían interpretarse como fórmulas.

## Panel master global

`SUPERADMIN` puede consultar `/platform` y el detalle
`/platform/organizations/[organizationId]`. El panel muestra agregados explícitos
por organización, memberships, último login de un miembro y actividad reciente
sin renderizar `oldValue` ni `newValue`. No crea organizaciones, no modifica
memberships y no concede acceso operativo: cualquier operación requiere una
membership activa y selección tenant explícita.

## Pendientes explícitos

Filtrado defensivo, pendiente de slice completa: receipts, payments, claims,
quotes, insurers, documents, WorkItems/tasks y risks. Fuera de alcance de esta
PR: mutaciones de esas áreas, reports, commissions, data-quality, Telegram,
imports, maintenance y jobs. Ninguna de estas áreas permite asumir contexto
tenant para escribir.

## Retirada de singleton

No retirar el índice singleton, guard de eliminación, triggers ni sincronización
legacy de memberships hasta que todas las escrituras y lecturas estén
tenant-aware, la suite de dos organizaciones y el restore drill con dos
organizaciones pasen. La prueba local de aislamiento debe usar exclusivamente
PostgreSQL desechable con `TENANT_ISOLATION_TEST_DB=1` y
`PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1`.

## Fixture de separación de Pedro

El job `tenant-isolation` crea únicamente en su base desechable las organizaciones
`org_legacy_singleton_0001` y `org_pedro_gomez_0001`. La segunda usa el nombre
visible `Pedro Alfredo Gómez Lorenzo` y el slug
`pedro-alfredo-gomez-lorenzo`; `pedroagl93@gmail.com` recibe `OWNER` únicamente
en esa fixture. Esta identidad no se provisiona en Preview ni en producción
durante Cycle 2A. La creación productiva requiere completar los gates de
aislamiento y restore con dos organizaciones.
