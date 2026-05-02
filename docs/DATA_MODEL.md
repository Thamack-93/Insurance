# PolicyDesk Data Model

## Entidades

### Client

Persona o empresa asegurada o prospecto.

Campos clave: nombre, tipo, email, telefono, RFC, direccion, contacto preferido, notas y estado.

Relaciones: polizas, recibos, pagos, comisiones, tareas, siniestros, cotizaciones y documentos.

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
- Define urgencia financiera.

Payment:

- Tiene fecha real.
- Tiene referencia.
- Tiene metodo.
- Confirma liquidacion.

Regla: no calcular cartera solo desde pagos; los recibos son el calendario financiero.

## Indices recomendados

- Fechas: `dueDate`, `renewalDate`, `expectedDate`, `startDate`, `createdAt`.
- Estados: `status`, `priority`.
- Relaciones: `clientId`, `policyId`, `insurerId`, `receiptId`.
- Busqueda: `policyNumber`, `receiptNumber`, `folio`, `fullName`, `name`.

