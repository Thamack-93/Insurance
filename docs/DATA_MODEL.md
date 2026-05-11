# PolicyDesk Data Model

## Entidades

### Client

Persona o empresa asegurada o prospecto.

Campos clave: nombre, tipo, email, telefono, RFC, direccion, contacto preferido, referidor, notas y estado.

Relaciones: polizas, recibos, pagos, comisiones, tareas, siniestros, cotizaciones, documentos y la self-relation `referidor` / `referidos` entre clientes.

Regla operativa: cuando una carpeta del escritorio agrupa expedientes de terceros, el folder principal representa al referidor y el cliente real puede vivir dentro de esa misma carpeta o aparecer solo dentro del PDF.

### Insurer

Aseguradora con portales y contacto operativo.

Relaciones: polizas, recibos, comisiones, tareas, siniestros y cotizaciones.

### Policy

Contrato central de seguro.

Campos clave: numero de poliza, cliente, aseguradora, tipo, estado, vigencia, renovacion, prima, moneda, frecuencia, plan, objeto asegurado y beneficiarios.

### Receipt

Obligacion financiera de pago/cobro.

Campos clave: numero de recibo, poliza, cliente, aseguradora, periodo, vencimiento, monto, moneda, estado, fecha de pago informativa, metodo y documento opcional.

### Payment

Evento real de pago.

Campos clave: recibo, poliza, cliente, monto, moneda, fecha, metodo y referencia.

### Commission

Ingreso esperado o real del agente.

Campos clave: poliza, recibo opcional, cliente, aseguradora, monto esperado, monto real, porcentaje, estado, fecha esperada y fecha cobrada.

### Task

Pendiente operativo.

Campos clave: folio, relaciones opcionales, titulo, descripcion, tipo, estado, prioridad, inicio, vencimiento y cierre.

### Claim

Siniestro.

Campos clave: folio, cliente, poliza, aseguradora, tipo, descripcion, estado, fechas y montos.

### Quote

Cotizacion.

Campos clave: cliente, aseguradora opcional, tipo de poliza, estado, fechas, monto cotizado y notas.

### Document

Archivo local seguro.

Campos clave: asociaciones opcionales, tipo, nombre, ruta, mime type, fecha de carga y notas.

### Reminder

Recordatorio generico por entidad.

### ActivityLog

Evento auditable para timeline.

### Alert

Alerta operacional con severidad, entidad y estado.

### Staging data

No es parte de la operación viva, pero sí de la conciliación:

- `source_record`: snapshot crudo de cada fuente.
- `field_candidate`: valores candidatos por campo.
- `field_decision`: decisiones verificables con estado humano separado.
- `entity_resolution`: vista consolidada por cliente, póliza o recibo.
- `review_queue`: cola de casos dudosos o conflictivos.
- `evidence_link`: vínculo de evidencia entre fuentes y decisiones.
- `canonical_client`, `canonical_insurer`, `canonical_policy`, `canonical_receipt`: primera limpia con forma de base real.
- `canonical_alias`, `canonical_field_lock`, `canonical_promotion_preview`: alias detectados, campos bloqueados y vista previa contra `pg.sqlite`.
- `canonical_policy_group`: agrupación operativa de renovaciones por cliente, aseguradora, ramo y serie/VIN cuando existe.
- `canonical_policy_history`: histórico importado, buscable pero no operativo.
- `canonical_payment_candidate`: candidatos de pago derivados de recibos pagados; separa evento de pago de obligación financiera.
- `canonical_adjustment_evidence`: endosos, ajustes e importes negativos conservados como evidencia.
- `external_ledger_import`, `external_ledger_snapshot`, `canonical_batch_diff`: versionado de corridas, snapshots normalizados y diff contra corrida anterior.
- `canonical_merge_suggestion`, `canonical_merge_rule`: sugerencias y aprobaciones humanas para mezclar clientes o grupos.

## Enums principales

- ClientType: `PERSON`, `COMPANY`
- EntityStatus: `ACTIVE`, `INACTIVE`, `ARCHIVED`
- PolicyStatus: `ACTIVE`, `EXPIRED`, `CANCELLED`, `RENEWED`, `PENDING`
- PolicyType: `AUTO`, `GMM`, `VIDA`, `DANOS`, `FIANZAS`, `HOGAR`, `RESPONSABILIDAD_CIVIL`, `EMPRESARIAL`, `ACCIDENTES`, `OTRO`
- PaymentFrequency: `MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`, `SINGLE`, `OTHER`
- ReceiptStatus: `PENDING`, `PAID`, `OVERDUE`, `CANCELLED`
- CommissionStatus: `EXPECTED`, `PENDING`, `PAID`, `OVERDUE`, `CANCELLED`
- TaskType: `GENERAL`, `CLAIM`, `QUOTE`, `RENEWAL`, `PAYMENT`, `DOCUMENT`, `COMMISSION`, `OTHER`
- TaskStatus: `OPEN`, `IN_PROGRESS`, `WAITING_CLIENT`, `WAITING_INSURER`, `WAITING_DOCUMENT`, `SENT`, `RESOLVED`, `CANCELLED`, `ARCHIVED`
- Priority: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
- AlertSeverity: `INFO`, `WARNING`, `CRITICAL`

## Receipt vs Payment

Receipt:

- Tiene vencimiento.
- Tiene periodo.
- Tiene monto esperado.
- Debe conservar `primaNeta` y `primaTotal` cuando venga de fuente externa.
- Define urgencia financiera.

Payment:

- Tiene fecha real.
- Tiene referencia.
- Tiene metodo.
- Confirma liquidacion.

Regla: no calcular cartera solo desde pagos; los recibos son el calendario financiero.

Regla de limpieza: `primaTotal` es el monto operativo de pago; `primaNeta` se conserva para analisis y conciliacion. Un recibo pagado puede generar un candidato `Payment`, pero no reemplaza al `Receipt`.

## Staging vs base real

- `data/pg.sqlite` sigue siendo la única base operativa viva.
- `data/staging/canonical.sqlite` se usa solo para conciliación, limpieza y revisión humana.
- El workbook de revisión es la interfaz para corregir campos sin tocar la base real.
- Ninguna decisión pasa a la base viva hasta que haya sido revisada en staging.

## Indices recomendados

- Fechas: `dueDate`, `renewalDate`, `expectedDate`, `startDate`, `createdAt`.
- Estados: `status`, `priority`.
- Relaciones: `clientId`, `policyId`, `insurerId`, `receiptId`.
- Busqueda: `policyNumber`, `receiptNumber`, `folio`, `fullName`, `name`.
