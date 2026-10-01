# Cierre de certificación de demos externas

Estado: **NOT READY FOR EXTERNAL DEMO ACCESS**.

## Candidato

Base de release integrada: `origin/main` en `09418e0d25f531f12cab6dd25d4599b2df925f34`.
Rama local: `codex/demo-certification-close`. El commit de código
`3036171c55c0d9d3ecf872063879976733935f8a` pasó los gates locales, pero no es
un SHA certificable en Neon: las ramas creadas para él heredaron datos de
`main`. Esta actualización cambia el árbol; obtener el nuevo SHA de `HEAD`
antes de cualquier certificación. No se ha publicado el candidato ni escrito
Production.

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
El spec `tests/api/demo-certification.spec.ts` quedó añadido explícitamente al
job `disposable-tenant`, donde existe el fixture requerido y
`TENANT_ISOLATION_E2E=1`; sigue pendiente de ejecución CI en el SHA publicado.

## Certificación y release

### Bloqueo de procedencia de datos

No certificar ni escribir en ninguna rama Neon hasta aprobar una fuente sin
datos reales. Las consultas agregadas de solo lectura confirmaron:

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

Se requiere que el operador identifique una base/branch aprobada y demuestre
que no contiene datos reales, o que autorice crear un proyecto Neon temporal
vacío.

### Flujo pendiente tras aprobar la fuente

Crear nuevas ramas `cert-stage3-<SHA completo>` y
`restore-cert-stage3-<SHA completo>` desde esa fuente, nunca desde `main`;
aplicar migraciones, fixture sintético, roles y cutover temporal, y ejecutar
RLS/concurrencia, auditoría y drift. Preparar el destino aislado y recuperar
el artifact VERIFIED. `RESTORE_DRILL_APP_SMOKE=0` sigue apagado.

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
Las ramas Neon no certificables se conservan sin cambios y sin borrarlas.
Production permanece intacto.
