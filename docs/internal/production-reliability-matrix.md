# Matriz de capacidad y estado operativo

Esta matriz distingue lo que el repositorio puede hacer de lo que está habilitado
en Production y de lo que se ha probado en una base PostgreSQL desechable. La
existencia de código, una migración o un script no demuestra por sí sola que una
capacidad esté activa en Production.

El contrato ejecutable del estado actual y el formato del verificador están en
[`production-state-contract.md`](production-state-contract.md). La verificación
se ejecuta con `npm run verify:production`; no aplica migraciones ni modifica
Production.

## Estado actual

| Capacidad | Código | Production actual | Evidencia disposable | Documentación |
|---|---|---|---|---|
| Contexto tenant y aislamiento de lecturas/escrituras | Implementado | Mono-tenant operativo; multi-org no activado | Fixture y checks disponibles | `docs/tenant-context.md` |
| Barrera singleton Cycle 1 | Implementada | Activa mientras exista una sola organización | Tests de transición disponibles | `docs/organizations-cycle-1.md` |
| Creación controlada de organizaciones | CLI y modelo implementados | Desactivada por flag; sin self-service | Fixture de dos/tres organizaciones | `docs/tenant-context.md` |
| Cutover multi-org y relación tenant | Script implementado | No ejecutado en Production | Ejecutable sólo en target disposable autorizado | `scripts/cutover-multi-org.ts` |
| Backup por organización | Implementado | Uso productivo no verificado aquí | Integración de backup disponible | Runbook de disaster recovery |
| Restore por organización | Implementado | Restore productivo no habilitado desde la UI | Restore temporal y validaciones disponibles | Runbook de disaster recovery |
| Rollback por organización | CLI break-glass implementado | No ejecutado | Requiere artifact y estado de restore | `scripts/rollback-organization.ts` |
| Importación por organización | CLI implementado | No ejecutada | Preflight y restore disposable disponibles | `scripts/import-organization-backup.ts` |
| RLS | Cutover y contexto SQL implementados | No verificado/activado en Production | Debe probarse con rol no-superusuario | `scripts/cutover-multi-org.ts` |
| Panel SUPERADMIN | Implementado | Habilitación productiva no verificada | Tests de dashboard y permisos | `docs/tenant-context.md` |
| Permisos y memberships multi-org | Implementados | Una membership por usuario en Cycle 2A | Tests de resolución y aislamiento | `docs/tenant-context.md` |
| Nora local | Implementado | Disponible según configuración | Tests unitarios | `src/lib/assistant-local.ts` |
| Nora admin/all | Configuración explícita implementada | Requiere `NORA_AGENT_MODE` explícito | Tests de resolución | `.env.example` |
| Knowledge GENERAL | Seed CLI implementado | Seed ACTIVE no verificado en Production | Check de integridad disponible | `docs/internal/nora-knowledge-reliability.md` |
| Knowledge INTERNAL | Implementado y ligado a organización | Datos activos no verificados aquí | Aislamiento disponible para fixture | `docs/internal/nora-knowledge-reliability.md` |
| Integridad y vigencia de knowledge | Checks implementados | Resultado Production no verificado | Check ejecutable contra disposable | `scripts/check-knowledge-integrity.ts` |
| Citas y abstención de Nora | Implementadas | Comportamiento productivo no verificado aquí | Tests unitarios y E2E disponibles | `docs/internal/nora-knowledge-reliability.md` |
| GMM metadata-only | Implementado | Uso productivo no verificado aquí | Tests de guardas y assistant | `docs/internal/nora-knowledge-reliability.md` |

## Estado de validación

Los jobs `quality`, `tenant-isolation` y `application` cubren niveles distintos.
Los jobs PostgreSQL, restore y E2E profundo se ejecutan manualmente mediante
`workflow_dispatch`; no son un candado para cada push o merge. La validación
manual sigue siendo necesaria antes de activar una segunda organización real,
RLS o una operación de restore/import.

El estado `Production actual` se actualizará sólo con evidencia del entorno
correspondiente. Mientras no exista esa evidencia, se conserva `REVIEW REQUIRED`
en el reporte de entrega y no se infiere un cutover por la presencia del código.
