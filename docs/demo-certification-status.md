# Cierre de certificación de demos externas

Estado: **NOT READY FOR EXTERNAL DEMO ACCESS**.

## Candidato

Base de release integrada: `origin/main` en `09418e0d25f531f12cab6dd25d4599b2df925f34`.
Rama local: `codex/demo-certification-close`. SHA final y evidencia de
ejecución se completan tras el commit. Todo cambio posterior requiere un SHA
y certificación nuevos. No se ha publicado el candidato ni escrito Production.

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

## Validación local renovada

Suite unitaria renovada: 650 PASS, 11 omitidas porque requieren PostgreSQL
desechable. Lint, typecheck, build, scopes de lectura/escritura (42 modelos),
DAL estricto (108 módulos), seguridad API (37 rutas), Server Actions,
ActivityLog, secrets y `git diff --check`: PASS. Las pruebas API/browser y la
certificación Neon deben ejecutarse contra el SHA fijado; la validación local
no es evidencia remota.

## Certificación y release

Proyecto Neon: `bitter-frost-67704350`. Crear desde main las ramas
`cert-stage3-<SHA completo>` y `restore-cert-stage3-<SHA completo>`.
Aplicar migraciones aditivas, fixture, roles, cutover temporal y pruebas
RLS/concurrencia, audit y drift en la fuente. Preparar el destino con esquema,
dependencias, rol runtime y marcador propios; modificar los datos sintéticos
y recuperar el artifact VERIFIED. `RESTORE_DRILL_APP_SMOKE=0` sigue apagado.

Tras completar Neon: publicar solo con autorización y ejecutar
`release-certification.yml` sobre el SHA, con `verify_production=false`.
Antes de escrituras productivas, presentar certificado, backup recuperable,
RPO observado, ventana y recuperación para aprobación explícita. Después del
cutover aprobado: verificador de solo lectura y smoke autenticado, provisión
DEMO temporal y flag apagado. Credenciales solo para prospecto y destinatario
identificados. Eliminar ramas/artefactos requiere una operación separada.

## Registro previo

Intentos anteriores de enviar credenciales owner a Vercel Preview fueron
rechazados antes de backup/restore. Ese flujo se retiró y no es evidencia.
El runner y el baseline RLS previos están preservados fuera del candidato.
Production permanece intacto.
