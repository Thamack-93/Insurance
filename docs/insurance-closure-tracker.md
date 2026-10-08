# Insurance — inventario único de cierre

Actualizado: 2026-10-07, America/Mexico_City. Coordinador: este chat (`01a0f61d-4183-7480-b783-b034e027858a`). Goal activo. La transferencia de chats organiza el historial; no acredita cierre productivo.

## Objetivo y responsables

Completar el backfill auditable de todas las pólizas, la comparación de renovaciones y una organización DEMO sintética con un usuario en la URL actual. Publicar READY FOR DAILY USE y READY FOR EXTERNAL DEMO ACCESS solo con evidencia verificable.

| Responsable | Modelo | Trabajo y checkout |
| --- | --- | --- |
| Coordinador | GPT-6.1 Sol / high | Integración, revisión, credenciales, GitHub/Vercel/Neon, operaciones productivas, tracker y aceptación |
| ci_close_luna | GPT-6 Luna / medium | PR #87, tests y CI; worktree insurance-ci-close |
| renewal_close_luna | GPT-6 Luna / medium | Comparación/preparación; reutiliza worktree renewal-comparison |
| demo_close_luna | GPT-6 Luna / medium | Pruebas/fixtures, reset y documentación; worktree insurance-demo-close |

Cada subagente trabaja en su checkout. Solo el coordinador publica ramas, dispara Actions y opera recursos remotos. Se preserva el checkout compartido en Desktop/Insurance, incluidos cambios y archivos duplicados no atribuidos.

## Transferencia de chats

| Chat fuente | Thread ID | Pendientes transferidos | Estado del historial |
| --- | --- | --- | --- |
| Certify PolicyDesk demo access | 01a0c49b-0147-79c3-9b14-57063e8f8c2f | Manifiesto real, backfill, restore, cutover y aceptación DEMO; gates D01–D09 | Transferido y archivado el 2026-10-07 |
| Audit Demo organization support | 01a0f587-a833-7f81-a2ff-110a3f089bdd | SUPERADMIN/flag efectivos, cobertura DEMO omitida, restricciones y docs/reset; D04–D09 | Transferido y archivado el 2026-10-07 |
| Audit PolicyDesk demo sandbox | 01a0adb3-f260-76d0-8acc-4dac70465893 | Procedencia de ramas/artefacto, destino independiente, restore CLI completo; D03 | Transferido y archivado el 2026-10-07 |
| Add vehicle descriptions to policies | 01a0f5e6-2b9f-72c1-90d7-6df71043b287 | Todas las pólizas y cotejo documental; D02 | Historial; los datos no se consideran convertidos |
| Corrige seguimiento de renovaciones | 01a0fe42-c8bf-7223-9601-1b8a3cd7a4e1 | Renovaciones/Operations integradas por PR #88 | Archivado previamente; conservar implementación |

Los tres chats DEMO se releerieron el 2026-10-07; estaban idle y sus últimas auditorías no contenían nuevos cambios de código ni operaciones productivas. Sus informes antiguos de CI #513 y de SHA 622e5745/cfd223e son históricos; se actualizan mediante evidencia nueva en este tracker. Sus archivos y diffs compartidos permanecen en el checkout original.

## Código y evidencia actual

- Main y Production consultados: fd1f7348ddb19fc7d6d63775983f818fc588f746. Vercel deployment dpl_9eXyg2gsmEPFp11U4UmTnXgQgtxs, READY, alias policypete.vercel.app. Metadatos autenticados confirmados por CLI; la sesión actual de Pedro accede al tenant pero /platform/organizations redirige a /today, coherente con el requisito SUPERADMIN.
- PR #91 y #87 integrados. CI #577 (37722760520), head 9060b06352400811d4b022f8816b354ee158b63d: quality, tenant-isolation y application PASS. Merge #87: 3b396f5f62f69ce359e4d07755c9ea2aef68b160. Vercel dpl_HkkfsqXD4rAj7fomZ6cdiH1abb9i READY en Production y alias policypete.vercel.app sirven ese SHA según metadata autenticada.
- Run histórico #546: 61 E2E pasaron, 3 fallaron, 16 omitidos. Sus tres selectores obsoletos están corregidos en main. También se comprobó un evento de menú absorbido por el pan del tablero: main fd1f734 ya incluye la corrección; se incorporó sin duplicarla.
- Candidato #87 local: build, TypeScript, lint, inventario, scope read/write y diff-check PASS. Unit: 708 PASS, 12 skipped; 124 archivos PASS, 6 skipped. Writer PostgreSQL forzado-RLS PASS, incluida inserción propia, rechazo cruzado, rollback y reanudación. Operations 12/12 PASS; navegación de renovación enfocada 1/1 PASS. DEMO API existente 2/2 PASS bajo policydesk_app. Los skips no acreditan integración.
- Comparación/preparación: rama hasta d7df897486bbca996ecca280b56ab037c0eedc07; nueve unit tests PASS, lint/typecheck/scope/build PASS, dos E2E ordinario/PDF PASS y uno de origen/cartera PASS bajo runtime restringido. El origen de otra cartera no se muestra; el trigger rechaza una relación entre organizaciones. Campos del origen autorizado intactos. Signos y centavos corregidos en revisión. Integrado en candidato local único; sin publicación.
- DEMO: integrada localmente hasta e06b76fa128429b608cf2da64ee9ddccd611e3f8. Reset exige motivo válido; parser rechaza otra bandera como valor (dos regresiones PASS). Caducidad de contraseña temporal probada. Tres API PASS en el candidato local 1b86f21, bajo policydesk_app y configuración permisiva igual a CI; búsqueda/export incluyen el seed propio y excluyen CUSTOMER, Nora/uploads rechazados. Primer intento local carecía del flag de exportación y fue rechazado correctamente; se preservó y diagnosticó antes de repetir, sin cambios de seguridad.
- PostgreSQL local recuperado: se liberaron únicamente dos segmentos huérfanos propios de 56 bytes, sin conexiones/PIDs activos; servidor existente preservado. Cluster privado en loopback:55439. Los procesos/red requieren ejecución autorizada fuera del sandbox; no borrar PID por su invisibilidad desde el sandbox.

## Estado productivo comprobado en solo lectura

Auditoría 2026-10-08 03:40 UTC en la conexión Production del proyecto Vercel verificado, con default_transaction_read_only=on y transacción REPEATABLE READ READ ONLY: una organización LEGACY ACTIVE; 269 pólizas, 264 con riskDetails no nulo y 264 con insuredObject no vacío; cero RLS habilitados/forzados de 52 tablas con organizationId; writeMode OPEN. No se aplicó backfill ni cutover. Tener riskDetails no nulo no acredita que la conversión cubra todos sus campos o filas; D02 sigue pendiente del manifiesto completo.

Hay un SUPERADMIN activo sin membership. Los artefactos catalogados recientes de organización/plataforma son DATABASE_ONLY; el último VERIFIED de organización fue 2026-10-07. No acreditan recuperación de archivos ni el drill requerido. Los detalles privados/credenciales permanecen fuera del repositorio. El checkpoint debe distinguir estos límites.

La auditoría del restore detectó prerrequisitos omitidos: el destino independiente necesita esquema/RLS, marcador propio y Organization/User/Plan dependientes antes del restore replace. El fixture también debe incluir campos de riesgo/bienes/personas/texto original y certificar valores, no solo conteos. Preparación CLI guardada en implementación antes de la única certificación final.

## Pendientes, aceptación y evidencia

| ID | Entrega / responsable | Criterio de cierre | Estado / siguiente evidencia |
| --- | --- | --- | --- |
| D01 | Candidato de backfill y CI / CI + coordinador | Mecanismo writer con permisos mínimos/RLS forzado, aislamiento, rollback y reanudación; tests Operations y código completo pasan sobre SHA exacto | CERRADO CÓDIGO: #87 CI #577 tres jobs PASS, merge3b396f5 y Vercel Production READY en ese SHA. Aplicación productiva del backfill sigue D02/D04 |
| D02 | Toda la base y cotejo / coordinador | Manifiesto privado por organización con todas las pólizas de todos los ramos, carteras y estados; reportar aplicadas, ya estructuradas y diferidas con motivo, incluida fuente ausente; totales sin omisiones ni duplicados | Sin manifiesto productivo ni apply confirmado. Habilitar vía segura los roles dedicados; preview y revisión preceden apply |
| D03 | Recuperación Neon / coordinador | Fuente sintética y destino hermanos independientes en proyecto autorizado, artefacto nuevo y restore CLI completo PASS | No PASS. Proyecto red-silence-07828324: main y cert-stage3-132ada7c; no destino independiente en la última lectura |
| D04 | Checkpoint y cutover / coordinador | SHA candidato, certificados, estado real Production, backup productivo comprobado y procedimiento de recuperación; aprobación explícita registrada; runtime/RLS/drift/clientes verificados | Preparar evidencia antes de pedir la aprobación productiva. Si el cutover ya está aplicado, verificarlo y omitir el cambio |
| D05 | Acceso de plataforma / coordinador | SUPERADMIN activo y flag efectivo para la sesión autorizada; SHA desplegado y recorridos autenticados confirmados | Production3b396f5 READY; auditoría READ ONLY confirma1SUPERADMIN activo sin membership. Sesión actual tenant no tiene /platform; pendiente acceso de esa cuenta y flag efectivo |
| D06 | Restricciones DEMO / DEMO + coordinador | Rechazos efectivos de uploads/importaciones/Nora/canales/proveedores y cero efectos externos aun con configuración permisiva; aislamiento en API/RLS/UI | Ejecutar expresamente tests/api/demo-certification.spec.ts con TENANT_ISOLATION_E2E=1 y completar cobertura necesaria; tests omitidos no cuentan como PASS |
| D07 | Cuenta y documentos / coordinador | Una organización y un usuario emitidos; contraseña temporal 24h, cambio obligatorio, edición sintética persistida y PDF privado sintético descargable | No usuario externo emitido. Reutilizar provisión/seed y trial de 30 días existentes |
| D08 | Reset y acceso / DEMO + coordinador | Reset idempotente con motivo, purga prefijo DEMO, CUSTOMER intacto, sesión revocada, suspensión/reactivación en escritorio/móvil | Pruebas enfocadas/locales y luego aceptación real pendientes |
| D09 | Cierre provisión/jobs / coordinador | Flag apagado tras entrega, credencial final emitida después de resets/pruebas y primer ciclo normal de jobs sin efectos externos | Pendiente. Credenciales solo en canal seguro; evidencia sin secretos |
| D10 | Comparación/preparación / renovaciones + coordinador | Estados CHANGED/ADDED/REMOVED/MISSING distintos; datos sin cambios inspeccionables; prima/moneda/frecuencia/riesgo/personas/bienes claros; legacy sin inferir; PDF y edición actualizan la misma comparación; origen no alterado por comparar; org/cartera respetadas | Código local, 9 unit y 3 E2E enfocados PASS, revisado. Candidato único preparado con DEMO; falta CI/publicación de la integración final. Avanza en paralelo y no bloquea DEMO |

## Decisiones y límites vigentes

- La aprobación anterior cubre integración y backfill controlado. El cutover conserva su aprobación explícita después de presentar el checkpoint concreto.
- Orden productivo: código certificado → recuperación comprobada → checkpoint aprobado → cutover/verificación → backfill → DEMO. El writer exige RLS forzado; no ejecutar apply en singleton incompatible.
- Una DEMO y un usuario son el alcance de esta entrega, no un nuevo límite global de usuarios/organizaciones. Reutilizar límites/capacidades existentes; no agregar infraestructura.
- PR #94 (exact serial suggestions, 17 archivos y conflicto de merge) y Nora quedan fuera de este ciclo; no fusionar automáticamente ni duplicar sistemas.
- La comparación es de lectura, sin esquema/rutas/estados de aprobación nuevos; preservar generación de recibos y Quálitas.
- PostgreSQL de tests debe ser local desechable, con TENANT_ISOLATION_TEST_DB=1 y PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1. Nunca credenciales Production/Preview.
- Sin corridas Actions por intentos especulativos. El coordinador publica candidatos con pruebas enfocadas y revisión; usar certificación completa del SHA final, compartida por los tres antiguos chats DEMO.

## Backfill y fuentes documentales

Conservar la matriz previa de 13 filas: 4 resueltas documentalmente, 6 con contratante/asegurado confirmados por el usuario y 3 autos accionables. No inferir otros campos en las seis de accidentes. Los detalles identificables están en el informe privado previo, no en este tracker. Estas 13 filas no delimitan el backfill: D02 cubre la base completa. Preservar insuredObject, riskDetails.sourceText, datos manuales y relaciones existentes; lotes reanudables de hasta 50.

## Recuperación y checkpoint

El proyecto de drill autorizado es policydesk-insurance-drill-20261005 (red-silence-07828324), distinto de Production. No reutilizar el destino vencido que heredó datos de la fuente; crear cert-stage3-S y restore-cert-stage3-S como hermanos con marcadores/fingerprints propios después de fijar S. La fuente contendrá campos nuevos, bienes, personas, texto original, pagos, cancelaciones, renovaciones, Notifications y WorkItems.

Restore exclusivamente mediante CLI existente, sobre destino temporal autorizado, con clave exclusiva del drill y RESTORE_DRILL_APP_SMOKE=0. Exigir conteos, FK públicos, Payment POSTED/REVERSED, invariantes de Policy/Receipt/cancelación/renovación, referencias Notification, compatibilidad WorkItem canónica/legacy, secuencias, lecturas bajo rol restringido y Prisma drift. session_replication_role=replica solo dentro de la transacción; origin antes de validar; rollback al fallar.

El drill sintético no acredita recuperación de un backup productivo concreto. El checkpoint debe describir responsable, backup productivo comprobado, destino temporal de recuperación y pasos para cambiar la conexión de aplicación al destino recuperado. Restaurar una rama temporal no revierte Production automáticamente. Credenciales temporales limitadas al recurso autorizado, nunca en repo/chat; no vercel env pull.

## Estados finales

- READY FOR DAILY USE: mejoras comprometidas/desplegadas en SHA verificable, recorridos autenticados y D01/D02/D10 cerrados con evidencia.
- READY FOR EXTERNAL DEMO ACCESS: D03–D09 cerrados con evidencia real, aprobación de checkpoint y cuenta sintética entregada.
- El Goal solo se completa con ambas entregas y todos los pendientes transferidos contabilizados. Archivar un chat tras transferirlo no significa completar su entrega.
