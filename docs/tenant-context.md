# Contexto de organización autenticado

Esta slice introduce el contexto de organización para lecturas y escrituras de
clientes, pólizas, Today, búsquedas de Nora y exportaciones. La selección se
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
- Policies: listado, detalle y acciones de alta/edición/borrado accesibles desde
  estas páginas.
- Nora: búsquedas informativas y referencias autorizadas dentro de la
  organización seleccionada.

El Excel incluye organización y timestamp, usa filename saneado, no se cachea y
escapa valores que podrían interpretarse como fórmulas.

## Pendientes explícitos

Receipts, payments, claims, quotes, insurers, documents, WorkItems/tasks,
reports, commissions, risks, data-quality, Telegram, imports, maintenance y
jobs requieren migraciones tenant-aware propias antes de retirar la barrera
singleton.

## Retirada de singleton

No retirar el índice singleton, guard de eliminación, triggers ni sincronización
legacy de memberships hasta que todas las escrituras y lecturas estén
tenant-aware, la suite de dos organizaciones y el restore drill con dos
organizaciones pasen. La prueba local de aislamiento debe usar exclusivamente
PostgreSQL desechable con `TENANT_ISOLATION_TEST_DB=1` y
`PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1`.
