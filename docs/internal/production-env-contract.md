# Contrato de variables de Production

PolicyDesk mantiene tres fuentes separadas: Vercel Production para el runtime,
el Environment `production-readonly-verification` de GitHub para la verificación
de solo lectura y el entorno local del operador para drills. No se deben copiar
secretos entre ellas ni usar un `.env` local para certificar Production.

El manifiesto sanitizado se genera con:

```bash
RELEASE_ENVIRONMENT=production \
npm run check:production-platform-env -- --profile=runtime --json
```

La certificación de solo lectura usa:

```bash
RELEASE_ENVIRONMENT=production \
npm run check:production-platform-env -- --profile=verification --json
```

El resultado contiene únicamente nombres, categorías, estados y razones. Nunca
incluye valores, longitudes, URLs, tokens, claves ni credenciales.

## Categorías

- `required`: conexión, sesión, cron, monitor y cifrado necesarios para el runtime.
- `active`: flags explícitas que deben ser `0` o `1` según la política vigente.
- `disabled`: capacidades deliberadamente apagadas, como Nora, email, billing y Quálitas.
- `verification-only`: rol y conexión `policydesk_readonly` usados por GitHub.
- `operator-only`: URLs administrativas, restore y variables `ALLOW_*`; nunca son runtime.
- `optional`: integraciones o compatibilidad que no bloquean la certificación por sí solas.

La ausencia de una variable requerida o una flag con valor distinto al esperado
produce `BLOCKED`. Las variables opcionales ausentes se reportan como
`not-configured` sin convertirlas en un bloqueo. El endpoint `/api/ready` y el
verificador de Production siguen siendo la evidencia final del entorno real.
