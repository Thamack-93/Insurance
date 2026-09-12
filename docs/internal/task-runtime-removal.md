# Task -> WorkItem: alcance y compatibilidad

## Decisión

`WorkItem` es la entidad operativa canónica para pendientes. El modelo y la tabla
`Task` se conservan temporalmente para históricos, migraciones y rollback. Los
flujos nuevos no deben crear, actualizar ni eliminar filas de `Task`.

## Estado implementado

| Área | Estado | Regla |
| --- | --- | --- |
| UI `/tasks` y detalle | Canónica | Resuelve por `WorkItem.id`; acepta `sourceType=Task` solo para rutas históricas. |
| Crear/editar pendientes | Canónica | Persiste exclusivamente `WorkItem`; un marcador legacy `Task` se normaliza al guardar. |
| Renovaciones y recordatorios | Canónica | Usa `sourceType=Renewal`, no `Task`. El recordatorio automático de "sin avance" usa `policy:<id>:renewal-followup`; el siguiente seguimiento manual usa `policy:<id>:renewal-manual-followup`. Ambos aparecen en WorkItem/Today, pero sólo el manual se puede programar, reprogramar o quitar desde el tablero. |
| Nora y asistente | Canónica | El tipo permitido es `workItem`; propuestas antiguas con `task` se rechazan con mensaje explícito. |
| Documentos nuevos | Canónica | Se rechaza `taskId` en uploads nuevos; los documentos históricos siguen siendo auditables. |
| Consolidación de clientes | Canónica | Actualiza `WorkItem`; no modifica los registros históricos de `Task`. |
| Búsqueda y cartera | Compatibilidad de lectura | Puede resolver referencias históricas `WorkItem(sourceType=Task)`, sin exponerlas como una entidad nueva. |
| Scripts de backfill/mantenimiento | Excepción controlada | Pueden leer o reparar `Task`, pero están fuera del runtime web y deben permanecer explícitos. |

## Auditoría

Ejecuta:

```bash
npm run check:legacy-workitem-refs
npm run check:legacy-workitem-refs -- --json
npm run check:legacy-workitem-refs -- --static-only
```

El comando es de solo lectura. Falla si encuentra escrituras runtime no
permitidas o un `WorkItem` legacy que apunta a un `Task` inexistente o tiene un
mapeo duplicado. El número de `Task` sin `WorkItem` y de documentos con el campo
legacy `taskId` se reporta como deuda histórica, pero no se modifica
automáticamente. `--static-only` permite ejecutar la comprobación de código sin
conexión a la base de datos.

## Siguiente migración de datos

Antes de eliminar `Task` físicamente hay que cerrar la deuda histórica:

1. Revisar el reporte en staging y exportar los conflictos.
2. Reasociar documentos legacy a una relación soportada o conservarlos como
   documentos históricos con política de acceso definida.
3. Congelar y respaldar la tabla `Task`.
4. Ejecutar una migración irreversible solo después de validar backups,
   búsquedas, exportaciones y permisos de cartera.
