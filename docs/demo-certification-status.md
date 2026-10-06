# Insurance release readiness

Última revisión: 2026-10-05.

El inventario y la evidencia operativa vigentes están en [insurance-closure-tracker.md](insurance-closure-tracker.md). Ese tracker es la fuente canónica para los chats fuente, el backfill, el restore y los gates de DEMO.

## Estado actual

- **READY FOR DAILY USE: pendiente.** El código de campos por ramo, renovaciones e Insights está integrado y desplegado; falta generar y revisar el manifiesto del backfill por organización, acordar el triage de los casos documentales y ejecutar el backfill aprobado.
- **READY FOR EXTERNAL DEMO ACCESS: pendiente.** No se ha ejecutado un restore remoto validado, no hay checkpoint aprobado de cutover y no se ha provisionado ni aceptado el usuario DEMO.

## Aplicación, CI y Production

- El código de aplicación actualmente registrado en Production es `cfd223e90ff4a37f2ba493bad36b6625569c82d3`, en el alias `policypete.vercel.app`.
- El deployment de Vercel Production tras fusionar PR #85 está `READY` en SHA documental `7293583faf26fd5c1c9e0e66d0e7fd1867dca4aa` (deployment `dpl_HP5yeVkFdnahSvRAfxpWR7jMYfVc`), verificado contra la API de Vercel. PR #85 fue solo documentación; el SHA de aplicación sigue en `cfd223e90ff4a37f2ba493bad36b6625569c82d3`.
- GitHub Actions Release Certification #464 terminó `SUCCESS` en el head documental `b8d16e5` de PR #82. Pasaron quality, tenant-isolation y application, incluidos PostgreSQL desechable, RLS, API, Chromium E2E y restore/backfill integration. Esta evidencia corresponde al SHA exacto del run; exige nueva certificación exact-SHA ante futuros cambios de aplicación. CI #474 también pasó sus tres jobs en el head exacto `6765e6d` de PR #85, un cambio documental; su [run](https://github.com/Thamack-93/Insurance/actions/runs/37393802145) no sustituye la certificación exact-SHA ante cambios de aplicación.
- La revisión autenticada de solo lectura confirmó que Insights, el tablero de renovaciones y el editor WorkItem cargan en Production. Se observaron señales de renovación antiguas que requieren triage operativo; no se modificaron registros.

## Backfill de pólizas

- PR #73, #78 y #80 están integrados. El CLI de preview read-only está implementado y su integración con RLS pasó en PostgreSQL desechable.
- No se ha conectado a Production, generado ni revisado el manifiesto, ni aplicado la conversión.
- Cierre: configurar una conexión dedicada de lectura `policydesk_readonly`, producir el reporte por organización, revisar los ambiguos y aprobar el plan de lotes antes de convertir. Conservar `riskDetails.sourceText`, permitir repetición sin duplicados y auditar cada lote.
- El cotejo documental queda como lo detalla el tracker. Sus datos identificables permanecen fuera de GitHub.

## DEMO y recuperación Neon

- La opción de menor alcance sigue siendo una organización sintética y un usuario temporal usando el seed existente en la URL actual. La cuenta todavía no existe y no se han entregado credenciales.
- El proyecto dedicado de drill registrado por el tracker es `policydesk-insurance-drill-20261005`. Su fuente candidata y destino temporal requieren reinspección antes de usarse: confirmar procedencia sintética, que el destino esté vacío y vigente, el artefacto de backup, y el SHA candidato exacto.
- No usar el proyecto/par de ramas antiguo que el tracker marca como rechazado. La contraseña de una credencial temporal quedó expuesta anteriormente: el operador debe rotarla en Neon antes de volver a conectar; no registrar ni compartir la nueva clave.
- Ejecutar solo mediante el restore CLI en una rama temporal autorizada, con `RESTORE_DRILL_APP_SMOKE=0` y credenciales limitadas al drill. Exigir el PASS completo descrito en el tracker; los metadatos o el tamaño del backup no bastan.
- Antes de cualquier cutover, presentar el SHA, el reporte de restore y el procedimiento concreto de recuperación. Esperar aprobación explícita antes de tocar Production. Después, validar aislamiento y clientes actuales; solo entonces provisionar una DEMO sintética, comprobar login, cambio de contraseña, restricciones, reset, revocación y escritorio/móvil, cerrar el flag de provisión y observar un ciclo de jobs.

## Criterios de cierre

Los dos resultados son independientes:

- **READY FOR DAILY USE:** backfill revisado y resuelto, cambios productivos verificados y triage operativo acordado.
- **READY FOR EXTERNAL DEMO ACCESS:** restore remoto PASS, aislamiento/cutover aprobado, usuario DEMO sintético y sus restricciones comprobados.

No archivar chats fuente hasta cotejar cada entrega con el tracker y adjuntar su evidencia de cierre.
