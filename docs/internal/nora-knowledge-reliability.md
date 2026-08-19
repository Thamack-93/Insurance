# Nora Knowledge Reliability

## Alcance

Nora sigue siendo un agente de solo lectura para cartera y preguntas de seguros. No se añaden web search, embeddings, proveedores ni mutaciones autónomas. La precisión y la abstención segura prevalecen sobre cobertura.

## Fuentes y ciclo de vida

- `KnowledgeSource` es `INTERNAL`, siempre ligado a `organizationId`; `GeneralKnowledgeSource` es `GENERAL` y global de plataforma.
- La aplicación crea fuentes tenant en `DRAFT`. `OWNER`/`ADMIN` puede previsualizar DRAFT/ACTIVE mediante `previewInternalKnowledgeSource`.
- Activar una fuente bloquea la clave organización/aseguradora/producto, archiva la activa anterior y verifica el manifiesto en la misma transacción.
- Una modificación de chunks o metadata incluida en el manifiesto limpia la verificación y convierte ACTIVE en DRAFT. ARCHIVED no se reactiva automáticamente; una corrección crea otra versión.
- El seed GENERAL vive exclusivamente en `scripts/seed-general-knowledge.ts` y se ejecuta por CLI.

## Integridad y vigencia

`contentHash` conserva su uso histórico para deduplicar ingestión. `manifestHash` es SHA-256 de un JSON canónico con título, versión y chunks ordenados por ordinal, página, sección y contenido. `integrityVersion` debe ser `CHUNK_MANIFEST_V1` y `integrityVerifiedAt` es obligatorio para recuperar una fuente. `effectiveFrom`/`effectiveTo` son fechas PostgreSQL `DATE`; la fecha `asOfDate` usa la zona de la organización y `America/Mexico_City` para GENERAL.

Antes de una migración sobre datos existentes se debe ejecutar `npm run check:knowledge-integrity`. El comando falla sin mutar ante duplicados activos, fuentes sin chunks, hashes inválidos o cruces tenant. El backfill requiere `ALLOW_KNOWLEDGE_INTEGRITY_BACKFILL=1` y reporta conteos.

## Recuperación, grounding y citas

`searchActiveKnowledgeBase` es la única interfaz de Nora: no acepta borradores, fusiona INTERNAL/GENERAL sin N+1, aplica FTS español, aliases y cobertura mínima de términos. Las preguntas contractuales solo consultan INTERNAL. Una respuesta KB exige resultados útiles y citas; el vacío, error, vigencia expirada o integridad inválida produce la abstención canónica.

Las citas se construyen únicamente desde resultados de aplicación y conservan `sourceId`, `chunkId`, `chunkOrdinal`, título, versión, autoridad, página y sección. Los excerpts son datos no confiables: nunca pueden cambiar organización, permisos, herramientas, SUPERADMIN ni preparar mutaciones. La trazabilidad persiste consulta redactada, IDs, conteo, motivo y duración; no persiste chunks ni texto libre KB en `responsePreview`.

## Enrutamiento y GMM

El clasificador determinístico prioriza mutación/borrador, búsqueda operacional de registros, conocimiento factual, pregunta contractual y finalmente bloqueo/abstención. “Busca la póliza 123” usa cartera; “qué significa prima” usa GENERAL; “qué deducible aplica a mi póliza” exige INTERNAL.

En GMM se permite metadata administrativa (folios, estados, fechas, reembolso, pago directo, cirugía programada y hospitalización administrativa). Diagnósticos, síntomas, tratamientos, medicamentos, estudios clínicos, proveedores identificables, facturas detalladas y archivos se bloquean. “Cirugía” u “hospitalización” sin contexto clínico no son sensibles. El modo GMM consulta únicamente la guía GENERAL curada de GMM.

## Administración y aceptación

`/settings/assistant` muestra fuentes tenant y el catálogo GENERAL en solo lectura, con estado, vigencia, autoridad, URL, revisión, chunks e integridad. La activación confirma metadata, conteo, integridad y versión que se archivará.

La aceptación requiere fixture reproducible de 32 preguntas, 100% de abstenciones esperadas, al menos 90% de aciertos top-3, cero cruces tenant, cero respuestas sin cita, migraciones/drift, guards tenant, API, E2E, lint, typecheck y build. Si un gate falla, la conclusión operativa es **No todavía**.
