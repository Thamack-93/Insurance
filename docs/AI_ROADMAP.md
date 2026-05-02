# PolicyDesk AI Roadmap

## Estado actual

PolicyDesk no integra IA en el MVP. La app debe funcionar completamente con datos estructurados, reglas deterministicas, Prisma y SQLite local.

## Principio central

IA sugiere; el usuario aprueba; Prisma guarda.

La IA no debe ser fuente de verdad para:

- Vencimientos.
- Renovaciones.
- Estados de recibos.
- Pagos.
- Comisiones.
- Riesgos criticos.

## Futuro posible

### Extraccion documental

- Extraer texto de PDFs.
- Guardar texto en una entidad futura `DocumentText`.
- Asociar texto al `Document` original.
- Mantener fecha de extraccion y version.

### Busqueda documental

- Dividir texto en chunks.
- Permitir busqueda lexical primero.
- Evaluar embeddings despues.
- Mantener resultados trazables al documento fuente.

### Sugerencias de IA

La IA podra sugerir:

- Numero de poliza detectado en PDF.
- Cliente probable.
- Aseguradora probable.
- Vigencia.
- Prima.
- Fecha de renovacion.
- Recibos esperados.
- Campos faltantes.

Cada sugerencia debe tener:

- Confianza.
- Fuente.
- Texto de evidencia.
- Accion de aceptar/rechazar.
- Registro en ActivityLog.

## Motores candidatos

- Ollama local para privacidad maxima.
- MiniMax M2.7 para razonamiento/documentos si se habilita cloud.
- Vercel AI Gateway si la app migra a arquitectura cloud.

## Seguridad

- No enviar PDFs sensibles a servicios externos sin aprobacion explicita.
- Redactar logs.
- Guardar prompts/respuestas solo si el usuario habilita auditoria.
- Separar IA de mutaciones directas.

## Fases futuras

1. Preparar modelo `DocumentText`.
2. Crear extractor local simple.
3. Crear UI de revision humana.
4. Agregar busqueda documental.
5. Evaluar IA local.
6. Evaluar IA cloud opcional.

