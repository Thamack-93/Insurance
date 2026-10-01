# Cierre de certificación de demos externas

Estado: **NOT READY FOR EXTERNAL DEMO ACCESS**.
Registro de verificación local: `2026-10-01`.

## Candidato

Base de integración actual: `main` en
`1ab53d0a589b30d47f82df763ef50b9cfc3444c2` (identificación de pólizas por
objeto asegurado). El candidato DEMO original `97a45cd6218550eb68766f47c56400f6f0f31fd9`
se integró sobre esa base en el merge `2506c1a2e179f70e75d1154f8c7cd0a80a2a6cd7`.
El arreglo de fixture/reset y la prueba autenticada de API quedaron en
`e8cf8da` (`fix: stabilize synthetic demo certification`). El SHA previo
`3036171c55c0d9d3ecf872063879976733935f8a` no es certificable en Neon: las
ramas creadas para él heredaron datos de `main`. La topbar mantiene el badge
DEMO y el mensaje contractual de bloqueo; el spec móvil los comprueba. El cierre
se publicó en `main` como `9250bda`; el ajuste del gate de CI quedó en
`492fab2`. Integrar el código no autoriza acceso externo.

## Diseño implementado

- El build valida su entorno y construye la app. El runner remoto se conserva
  como referencia local fuera del candidato y no se invoca durante el build.
- Backup: CUSTOMER sintético, sin documentos, con pagos POSTED/REVERSED,
  cancelaciones, renovación, Notification y WorkItems canónicos/legacy.
  DEMO permanece excluido de backups. `--skip-prune` requiere ramas Neon
  temporales identificadas, admin directo y runtime pooled `policydesk_app`.
- Restore: compara manifiesto, payload y conteos restaurados del tenant;
  valida FK, invariantes, referencias, WorkItems y secuencias dentro de la
  transacción. Después exige lecturas Prisma/SQL con runtime pooled y RLS,
  auditoría multi-org y drift. Un fallo posterior produce FAIL, nunca PASS.
- Informe/certificado 0600 identifican SHA, ramas, fingerprints, artifactId y
  resultados; no contienen connection strings. Clave de cifrado exclusiva del
  drill se inyecta por proceso y se conserva fuera del repositorio.
- DEMO se recupera con seed, reset idempotente y revocación. Nora y proveedores
  permanecen bloqueados; WhatsApp es vista previa local; uploads reales se
  rechazan.
- En todas las rutas del dashboard DEMO, la cabecera fija mantiene visible el
  badge y `Esta acción está deshabilitada en la organización de demostración.`

## Validación local renovada

Verificación aislada posterior al SHA exacto
`97a45cd6218550eb68766f47c56400f6f0f31fd9`: `npm ci --offline` PASS (1,088
paquetes, auditoría npm sin vulnerabilidades); Prisma generate, lint, typecheck,
build, scopes de lectura/escritura (42 modelos), DAL estricto (108 módulos),
seguridad API (37 rutas), Server Actions, ActivityLog, secrets (926 archivos),
metadata, navegación, Quálitas, límite recibos/pagos y `git diff --check`:
PASS. Unitarias: 650 PASS, 11 omitidas por requerir PostgreSQL desechable.
Las pruebas API/browser no se ejecutaron localmente. El spec
`tests/api/demo-certification.spec.ts` está cableado al job `disposable-tenant`
con `TENANT_ISOLATION_E2E=1` y comprueba en móvil el badge y el mensaje DEMO;
sigue pendiente de ejecutarse en el job de aislamiento tenant. Esta verificación
local no sustituye la certificación Neon ni el backup/restore remoto.

## CI y estado de plataforma

El push inicial `9250bda` falló en el escáner estático de compatibilidad
`Task -> WorkItem`, que clasificaba como escritura runtime una fila sintética
creada por `scripts/setup-tenant-isolation-fixture.ts`. El fixture exige una
base desechable; `492fab2` lo clasificó explícitamente como script de fixture.
La ejecución CI #384 en `492fab2` terminó **success**: el job `quality` pasó.
Los jobs `tenant-isolation` y `application` se omitieron por ser un evento
`push`; la configuración los reserva para `workflow_dispatch` o `pull_request`.
Por eso aún falta la prueba remota RLS/API/browser.

El status Vercel de GitHub figura como **failure**. La conexión disponible de
Vercel respondió 403 al listar deployments; no pudimos confirmar si existe un
deployment fallido o si falla únicamente la integración de permisos. Production
no se considera verificado.

## Certificación y release

### Fuente sintética Neon verificada

El 2026-10-01 el usuario autorizó un proyecto temporal Neon Free y Blob privado
exclusivos del drill. Las comprobaciones de solo lectura confirmaron:

- Proyecto `policydesk-certification-20261001`
  (`morning-block-38616998`), en `aws-us-east-1`; rama vacía `main`
  (`br-odd-sound-b7js2mbk`).
- Fuente `cert-stage3-97a45cd6218550eb68766f47c56400f6f0f31fd9`
  (`br-super-bird-b7b8dz8x`) y destino
  `restore-cert-stage3-97a45cd6218550eb68766f47c56400f6f0f31fd9`
  (`br-proud-cloud-b7b2nxc8`), ambos `ready`, hijos directos de ese `main`
  con el mismo parent LSN `0/1B9D098`.
- La base `policydesk_cert_97a45cd` existe en ambas ramas. `table-sizes`
  devolvió cero tablas de usuario en las dos; no hay evidencia de fixture,
  migraciones, backup o restore en ellas. La base parte vacía, pero estas ramas
  llevan el SHA anterior `97a45cd` en el nombre y no certifican `492fab2`.
  Todavía no hay certificación de recuperación.
- El coordinador reportó un Blob privado `store_dYfsJwqceS3nQGOI` sin archivos
  y desconectado; ese dato no se verificó con una lectura independiente aquí.
- Los endpoints Neon observados tienen `disabled=false` y estado `idle`, con
  `suspended_at` registrado. Es compute en reposo/auto-suspend, no un proyecto
  deshabilitado ni una prueba de haber alcanzado el límite de proyectos. El
  recurso temporal se provisionó sin conectar variables a Vercel
  (`--no-connect --no-env-pull`).

Las dos ramas Neon actuales se nombraron para el SHA anterior `97a45cd`. El
árbol integrado ahora tiene el commit de código `e8cf8da`; esas ramas siguen
vacías y no cuentan como destino certificado para este nuevo SHA. Para certificar
`e8cf8da` se necesita una pareja de ramas identificada con el SHA completo y la
aprobación explícita del destino antes de cualquier restore.

Sigue pendiente usar un runner GitHub-hosted con credenciales
limitadas a este proyecto/Blob y a estas dos ramas. No se ha leído ni transferido
ningún secreto de este proyecto. La clave de cifrado debe generarse dentro del
job para una sola ejecución y no conservarse. No usar la clave de Production,
no modificar sus variables y no ejecutar migraciones, fixture, backup o restore
hasta que el destino y el alcance de esos secretos estén autorizados. No se
guardarán credenciales en la Mac ni en archivos del workspace.

El repositorio es privado. Si la cuenta GitHub usa Free, los secretos de
entorno no están disponibles para repos privados. Los secretos de repositorio
son una alternativa, pero cualquier workflow del repositorio que los referencie
podría usarlos; ese alcance más amplio tiene que quedar aprobado antes de
configurar el runner.

Las fuentes históricas siguientes siguen siendo inválidas y no deben usarse:

- `main` tiene 1 organización, 47 clientes y 262 pólizas; cero emails
  `example.invalid`, cero pólizas DEMO/SYNTHETIC y ningún marcador.
- `cert-stage3-3036171...` (`br-super-meadow-apswlgqg`) y
  `restore-cert-stage3-3036171...` (`br-steep-firefly-apqz3iko`) se crearon
  desde `main`. No se modificaron; quedan preservadas, pero no son evidencia
  y no deben usarse para fixture, backup ni restore.
- La histórica `cert-stage3-2026091801a0adb4` tiene CUSTOMER con 2 clientes y
  2 pólizas sin marcas sintéticas; DEMO con 26 clientes/21 pólizas (25 emails
  sintéticos y 20 pólizas DEMO); LEGACY con 48/262 y un WorkItem con referencia
  canónica de Policy inválida. No está aprobada como origen.
- La histórica `cert-stage3-2026091801a0adb3` no tiene organizaciones,
  clientes ni pólizas, pero conserva 3 usuarios (uno fuera de dominios de
  fixture) y un esquema anterior. Tampoco es una fuente limpia certificada.

### Flujo pendiente tras aprobar la inyección de secretos

Tras aprobar el alcance de secretos y ramas, provisionar la pareja Neon vacía
para el SHA integrado, aplicar migraciones, fixture sintético, roles y cutover
temporal en la fuente, y ejecutar RLS/concurrencia, auditoría y drift. Preparar
el destino aislado y recuperar el artifact VERIFIED. `RESTORE_DRILL_APP_SMOKE=0`
sigue apagado.

La calidad CI pasó en `492fab2`; siguen pendientes CI RLS/API/browser y el
backup/restore remoto sobre el SHA integrado. Completar esos pasos y actualizar
este estado antes de habilitar cualquier acceso DEMO externo. No ejecutar el
verificador de Production como parte del drill. Antes de escrituras productivas,
presentar certificado, backup recuperable,
RPO observado, ventana y recuperación para aprobación explícita. Después del
cutover aprobado: verificador de solo lectura y smoke autenticado, provisión
DEMO temporal y flag apagado. Credenciales solo para prospecto y destinatario
identificados. Eliminar ramas/artefactos requiere una operación separada.

## Registro previo

Intentos anteriores de enviar credenciales owner a Vercel Preview fueron
rechazados antes de backup/restore. Ese flujo se retiró y no es evidencia.
El runner y el baseline RLS previos están preservados fuera del candidato.
Las ramas Neon no certificables se conservan sin cambios y sin borrarlas. No se
crearon ni modificaron datos, tenants o usuarios DEMO en Production. El push a
`main` puede iniciar el despliegue habitual de Vercel; su resultado no está
verificado en este informe.

## Verificación del checkout compartido

En el checkout compartido el 2026-10-01 pasaron `npm run typecheck`, ESLint de
los cuatro archivos DEMO modificados y `npm run test:unit` (**654 PASS, 11
SKIP**). Los omitidos requieren PostgreSQL desechable. También pasaron los
scopes tenant de lectura y escritura (42 modelos), DAL estricto (110 módulos),
seguridad API (37 rutas), Server Actions, ActivityLog y secrets (926 archivos).
Se comparó el contenido de todos los archivos rastreados y coincide con el
árbol de código del commit `e8cf8da`. La verificación aislada previa de
`97a45cd` reportó 108 módulos DAL; el checkout compartido e integrado cuenta
110. Estas son validaciones locales, no CI remoto y no certifican RLS real ni
backup/restore.
