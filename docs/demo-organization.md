# Organización DEMO

La organización DEMO es un espacio sales-assisted para prospectos. Usa la
autenticación normal de PolicyDesk, tiene una sola membresía por usuario y
contiene únicamente datos sintéticos prefijados con `DEMO`.

## Provisión y acceso

Un superadministrador habilita temporalmente `PLATFORM_ORG_PROVISIONING_ENABLED=1`
y usa `/platform/organizations` para provisionar la organización y hasta cinco
usuarios. Las contraseñas temporales se muestran una sola vez, expiran en 24
horas y obligan al cambio en el primer acceso. No hay signup público,
invitaciones ni selector de organizaciones.

## Capacidades DEMO v1

El usuario puede explorar y modificar clientes, pólizas, recibos, cobranza,
siniestros, tareas, comisiones, búsquedas, reportes y documentos sintéticos.
El seed incluye 25 clientes, 20 pólizas y 95 recibos generados con 5 pólizas
por cada frecuencia: anual, semestral, trimestral y mensual.
Las cargas de archivos y las importaciones permanecen bloqueadas. Nora,
Telegram, email, Quálitas y las operaciones con proveedores están deshabilitados. WhatsApp solo muestra
una vista previa local con texto sintético: no pide teléfonos, no abre la
aplicación, no adjunta archivos ni envía mensajes.

Las descargas de documentos incluidos se resuelven como PDFs sintéticos
privados y no contienen información real. No se aceptan documentos del
prospecto en esta versión.

## Reset

El reset exige identificar explícitamente una organización cuyo `kind` sea
`DEMO`; rechaza CUSTOMER, LEGACY y estados ambiguos. Es idempotente, revoca
sesiones, purga objetos privados del prefijo del tenant, borra filas de la
cartera DEMO y vuelve a ejecutar el seed determinista. La vista previa no
modifica filas.

```sh
npm run demo:reset -- --organization-id org_demo_x --request-id ticket-123 --dry-run
npm run demo:reset -- --organization-id org_demo_x --request-id ticket-124 --reason "reset para nueva demostración"
```

El reset nunca opera sobre respaldos ni sobre otra organización. Ante un fallo,
el tenant queda suspendido para revisión operativa.

## Rotación y retirada

Un superadministrador suspende el DEMO desde `/platform/organizations`, revoca
las sesiones y entrega nuevas credenciales temporales mediante un canal seguro.
Para retirar el acceso, suspende la organización y conserva el registro de
auditoría; la eliminación definitiva sigue siendo una operación separada y
autorizada de plataforma.

## Certificación remota de backup y restore

Las organizaciones DEMO están excluidas de los respaldos. El drill usa el
fixture CUSTOMER totalmente sintético, sin documentos, de la rama
Neon `cert-stage3-<SHA completo>`. Se restaura en una rama independiente
`restore-cert-stage3-<SHA completo>`. Los casos incluyen pagos POSTED y
REVERSED, cancelaciones, renovación y WorkItems canónicos/legacy.

Se usan exclusivamente `backup:create:organization -- --organization=<id>
--skip-prune` y `restore:organization:temp-neon -- --organization=<id>
--artifact=<id> --apply`. Ningún runner se conecta al build. Preview y
Production se rechazan. Las credenciales se inyectan al proceso desde fuera
del repo. La clave de cifrado es exclusiva del drill y se conserva con
permisos restringidos junto a la evidencia, nunca en un informe.

La ejecución requiere `NODE_ENV=test`, `TENANT_ISOLATION_TEST_DB=1`,
`PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1`, `CERTIFICATION_CANDIDATE_SHA`,
`TENANT_CERTIFICATION_ORGANIZATION_ID`, `TENANT_CERTIFICATION_REMOTE_BRANCH=1`,
`TENANT_ISOLATION_REMOTE_BRANCH=1`, las variables de identidad
`TENANT_ISOLATION_{RUN_ID,DB_NAME,FINGERPRINT,BRANCH_ID,BRANCH_NAME,NEON_HOST}`,
`DATABASE_ADMIN_URL` directa y `DATABASE_URL` pooled con `policydesk_app`,
`ALLOW_OPERATOR_BACKUP=1`,
`ALLOW_TEMPORARY_NEON_RESTORE=true`, `RESTORE_NEON_BRANCH`,
`RESTORE_NEON_BRANCH_ID`, `RESTORE_NEON_HOST`, `RESTORE_TARGET_FINGERPRINT`,
`RESTORE_DATABASE_URL` directa y `RESTORE_RUNTIME_DATABASE_URL` pooled,
`RESTORE_ACTOR_USER_ID` y `RESTORE_REASON`. Las dos marcas reales de base
deben coincidir con su identidad de rama y fingerprint. Mantiene
`RESTORE_DRILL_APP_SMOKE=0`. No ejecuta una base de datos local.

El CLI conserva los objetos Blob existentes mediante `--skip-prune`,
crea y verifica el respaldo cifrado, restaura únicamente el tenant sintético
y comprueba conteos reales contra manifiesto y payload antes de hacer commit.
Después verifica claves foráneas, invariantes, secuencias, lecturas con el rol
`policydesk_app` sin bypass RLS, rechazo de lecturas sin contexto y ajenas,
drift Prisma y auditoría multi-organización.

El informe y certificado se guardan en `artifacts/restore-drills` (0600).
PASS requiere lecturas Prisma con rol runtime bajo RLS, auditoría multi-org
y drift después del commit. Un fallo transaccional hace rollback; un fallo
posterior produce certificado FAIL y deja el destino aislado. El certificado
registra SHA, ambas ramas/fingerprints, artifactId y resultados sin secretos.
DEMO se recupera mediante seed, reset idempotente y revocación, no backup.
Este drill no sustituye las pruebas browser/API ni los gates de Production.
