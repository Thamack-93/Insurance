# PolicyDesk: Product and Architecture Plan

## 1. Vision completa del producto

PolicyDesk es un cockpit local-first para administrar una cartera de seguros desde una Mac. No es un ERP ni una tabla administrativa: es una herramienta diaria para que un agente sepa que hacer hoy, donde cobrar, que renovar, que documento falta, que cliente contactar y que riesgo resolver.

El producto se organiza alrededor de una cadena operacional:

`Cliente -> Poliza -> Recibo -> Pago -> Comision -> Pendiente -> Documento -> Actividad -> Riesgo`

Principios de producto:

- Dashboard-first: al abrir la app se debe entender la cartera en segundos.
- Action-oriented: cada alerta o dato importante debe sugerir una accion.
- Local-first: SQLite, filesystem local, scripts seguros y funcionamiento sin cloud.
- Database-first: la verdad vive en datos estructurados, no en IA ni archivos sueltos.
- Visual-first: la UI debe sentirse premium, clara y altamente operable.
- Receipt-first finance: el recibo representa la obligacion; el pago representa el evento real.
- Auditabilidad: eventos importantes deben registrarse en activity log.
- IA opcional despues: la IA puede sugerir, nunca ser fuente de verdad del MVP.

## 2. Arquitectura completa

Stack obligatorio:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- SQLite
- TanStack Table
- React Hook Form
- Zod
- date-fns
- Lucide icons
- Recharts
- Framer Motion

Arquitectura local:

- Base de datos: `data/policydesk.sqlite`
- Backups: `data/backups`
- Documentos: `data/documents`
- Exportaciones: `data/exports`
- Prisma sera la unica via aceptada para leer o modificar SQLite.
- Los documentos sensibles nunca se guardan en `public`.
- Scripts TypeScript viven en `scripts/` y deben crear backup antes de operaciones destructivas o masivas.

Capas:

- `app/`: rutas, layouts, pages, server actions y route handlers.
- `components/`: componentes UI reutilizables por dominio y layout.
- `lib/`: reglas de negocio, queries, helpers, validaciones, seguridad local, exports y backups.
- `prisma/`: schema y seed.
- `scripts/`: operaciones seguras para Codex y mantenimiento local.
- `docs/`: decisiones, roadmap, modelo, UI system y operaciones.

Data flow recomendado:

- Lecturas: Server Components llaman queries de `lib/*-queries.ts`.
- Mutaciones: Server Actions validan con Zod, escriben via Prisma, registran `ActivityLog` y revalidan rutas.
- Documentos: API routes controlan upload/download/preview sin exponer rutas publicas.
- Scripts: usan Prisma y helpers compartidos; nunca SQL manual destructivo.

## 3. Modelo de datos completo

Entidades principales:

- `Client`: persona o empresa, contacto, RFC, estado, notas y relaciones comerciales.
- `Insurer`: aseguradora, portales, contacto y estado.
- `Policy`: contrato central con vigencia, prima, renovacion, frecuencia y objeto asegurado.
- `Receipt`: obligacion de pago/cobro ligada a poliza, cliente y aseguradora.
- `Payment`: evento real de pago ligado a recibo, poliza y cliente.
- `Commission`: ingreso esperado o real del agente.
- `Task`: pendiente operativo con folio, prioridad, estado y relaciones opcionales.
- `Claim`: siniestro ligado a cliente, poliza y aseguradora.
- `Quote`: cotizacion ligada a cliente, tipo de poliza y aseguradora opcional.
- `Document`: archivo local asociado a entidades.
- `Reminder`: recordatorio por entidad.
- `ActivityLog`: timeline auditable.
- `Alert`: alerta operacional deterministica o manual.

Separacion Receipt vs Payment:

- `Receipt` responde: cuanto se debe pagar, cuando vence y de que periodo es.
- `Payment` responde: cuando se pago realmente, por que medio y con que referencia.
- Un recibo puede existir sin pago.
- Un pago siempre debe apuntar a un recibo para mantener trazabilidad.
- Una comision puede apuntar a una poliza y opcionalmente a un recibo.

Invariantes iniciales:

- `Policy.endDate` no debe ser anterior a `Policy.startDate`.
- `Policy.renewalDate` no debe ser posterior de forma absurda al final de vigencia sin justificacion.
- `Receipt.dueDate` debe estar dentro o cerca del periodo que representa.
- `Receipt.periodEndDate` no debe ser anterior a `periodStartDate`.
- `Payment.paidDate` no debe existir para recibos cancelados salvo nota explicita.
- `Document.filePath` debe apuntar fuera de `public`.
- Numeros de poliza duplicados se permiten solo si la aseguradora o contexto lo justifica; por defecto generan alerta.
- Numeros de recibo duplicados por poliza generan alerta.

## 4. Entidades y relaciones

Relaciones clave:

- Un cliente tiene muchas polizas, recibos, pagos, comisiones, tareas, siniestros, cotizaciones y documentos.
- Una aseguradora tiene muchas polizas, recibos, comisiones, tareas, siniestros y cotizaciones.
- Una poliza pertenece a un cliente y aseguradora, y tiene recibos, pagos, comisiones, tareas, documentos, siniestros y actividad.
- Un recibo pertenece a poliza, cliente y aseguradora; puede tener pagos, comision y documento opcional.
- Un pago pertenece a recibo, poliza y cliente.
- Una comision pertenece a poliza, cliente y aseguradora; puede pertenecer a recibo.
- Una tarea puede asociarse opcionalmente con cliente, poliza, aseguradora y recibo.
- Un documento puede asociarse opcionalmente con cliente, poliza, recibo, tarea, siniestro o cotizacion.
- ActivityLog y Alert usan `entityType` + `entityId` para cubrir todo el dominio.

## 5. Pantallas previstas

Pantallas MVP:

- `/dashboard`: KPIs, charts, urgencias, riesgos, actividad y documentos faltantes.
- `/today`: cockpit operativo diario.
- `/portfolio`: salud de cartera, prima administrada, distribuciones y clientes clave.
- `/due-payments`: recibos proximos y vencidos.
- `/renewals`: renovaciones en tabla y kanban.
- `/tasks`: pendientes en tabla y board.
- `/clients`: listado premium de clientes.
- `/clients/[id]`: ficha de cliente con tabs y timeline.
- `/policies`: listado de polizas.
- `/policies/[id]`: ficha de poliza con tabs.
- `/receipts`: recibos y generacion esperada.
- `/commissions`: comisiones esperadas, pendientes, cobradas y vencidas.
- `/documents`: document center seguro.
- `/risks`: alertas operativas.
- `/reports`: reportes exportables.
- `/settings`: catalogos, backup, moneda, rangos de alerta y base de datos.

Pantallas posteriores:

- `/claims`: siniestros, seguimiento y documentos.
- `/quotes`: cotizaciones, expiraciones y seguimiento.
- `/data-quality`: scores de completitud y acciones sugeridas.

## 6. Componentes UI principales

Layout:

- `AppSidebar`
- `AppTopbar`
- `GlobalSearch`
- `CommandPalette`
- `Breadcrumbs`
- `PageHeader`
- `SectionHeader`

Dashboard y datos:

- `KpiCard`
- `ChartCard`
- `StatGrid`
- `DataTable`
- `StatusBadge`
- `PriorityBadge`
- `RiskAlertCard`
- `DocumentCard`
- `ActivityTimeline`

Interaccion:

- `DetailDrawer`
- `ConfirmDialog`
- `QuickActionButton`
- `DateRangeFilter`
- `FilterChips`
- `DensityToggle`
- `BulkActionBar`

Estados:

- `EmptyState`
- `LoadingSkeleton`
- `InlineError`
- `Toast`
- `Tooltip`

Formularios:

- Forms con React Hook Form + Zod.
- Validaciones compartidas en `lib/validations.ts`.
- Errores utiles, no tecnicos.

## 7. Logica de negocio

Vencimientos:

- `overdue`: fecha pasada.
- `urgent`: 0 a 7 dias.
- `soon`: 8 a 15 dias.
- `upcoming`: 16 a 60 dias.
- `future`: mas de 60 dias.

Renovaciones:

- Mostrar proximas 60 dias por defecto.
- Generar riesgo si la poliza no tiene `renewalDate`.
- Generar riesgo si hay renovacion proxima sin pendiente.
- Generar riesgo si la poliza vencio sin estar renovada/cancelada.

Pendientes:

- Calcular dias desde inicio.
- Calcular atraso con `dueDate`.
- Resaltar prioridad alta y urgente.
- Board por estado operativo.
- Cierre debe registrar `closedDate` y ActivityLog.

Comisiones:

- Distinguir esperada, pendiente, pagada, vencida y cancelada.
- Calcular diferencia entre `expectedAmount` y `actualAmount`.
- Agrupar por mes, aseguradora, cliente y poliza.
- Comision vencida sin `paidDate` genera riesgo.

Riesgos:

- Polizas sin fecha de renovacion.
- Polizas sin documento PDF.
- Polizas vencidas.
- Recibos vencidos sin pago.
- Recibos pagados sin comprobante.
- Comisiones vencidas sin cobro.
- Pendientes abiertos mas de 15 dias.
- Cotizaciones sin seguimiento.
- Clientes sin telefono o email.
- Numeros de poliza duplicados.
- Recibos duplicados.
- Fechas inconsistentes.
- Renovaciones proximas sin pendiente.
- Documentos huerfanos.
- Clientes sin polizas activas.

Documentos:

- Upload local a `data/documents`.
- Guardar metadata y ruta en `Document`.
- Descargar via route handler seguro.
- Eliminar con confirmacion y backup si aplica.
- Preparar para extraccion de texto futura.

Calidad de datos:

- Score por cliente.
- Score por poliza.
- Lista de campos faltantes.
- Acciones sugeridas.
- Filtros por severidad e impacto.

Timeline:

- Cliente creado.
- Poliza creada.
- Recibo creado.
- Recibo marcado como pagado.
- Pendiente creado/cerrado.
- Documento cargado.
- Comision marcada como cobrada.
- Renovacion actualizada.
- Alerta resuelta.

## 8. Roadmap por fases

| Fase | Objetivo | Entregables |
| --- | --- | --- |
| 0 | Plan maestro | Documentos, decisiones, riesgos, roadmap y reglas Codex |
| 1 | Fundacion MVP | Proyecto, Prisma, seed, layout, Dashboard, Hoy y scripts base |
| 2 | Core CRM | Clientes, aseguradoras, polizas, recibos y tareas con CRUD y detalles |
| 3 | Operacion diaria | Vencimientos, renovaciones, filtros, drawers, acciones y navegacion cruzada |
| 4 | Finanzas | Comisiones, reportes, exports, cartera y conciliacion basica |
| 5 | Documentos | Upload seguro, asociaciones, preview, descarga, rename/delete y faltantes |
| 6 | Riesgos y calidad | Risk engine, data quality, timeline, alertas y validaciones |
| 7 | UX premium | Command palette, favoritos, recientes, bulk actions, dark mode y polish |
| 8 | Expansion futura | Cloud-ready, IA opcional, empaquetado Mac, restore y hardening |

## 9. Definition of Done por fase

Fase 0:

- Documentacion creada en `docs/`.
- Decisiones arquitectonicas registradas.
- Reglas de operacion Codex escritas.
- MVP y fuera de scope claros.

Fase 1:

- `npm run dev` corre sin errores.
- `npm run db:migrate` crea SQLite local.
- `npm run db:seed` genera demo rica.
- Dashboard muestra KPIs correctos.
- Hoy muestra acciones operativas.
- Scripts base corren.
- UI no parece admin generico.

Fase 2:

- Listados y detalles core navegables.
- Formularios validados con Zod.
- Relaciones visibles.
- ActivityLog para acciones importantes.

Fase 3:

- Vencimientos proximos y vencidos funcionan.
- Renovaciones tabla/kanban funcionan.
- Filtros principales funcionan.
- Drawer lateral muestra detalle rapido.
- Acciones rapidas registran cambios.

Fase 4:

- Comisiones por estado y mes funcionan.
- Reportes principales exportan CSV y Excel si viable.
- Metricas de cartera son consistentes.

Fase 5:

- Documentos nunca pasan por `public`.
- Upload/download seguros funcionan.
- Asociaciones con entidades funcionan.
- Documentos faltantes se detectan.

Fase 6:

- Risk engine genera alertas utiles.
- Data quality muestra scores.
- Validacion por script reporta problemas.
- Timeline permite entender historial.

Fase 7:

- UX se siente premium y rapida.
- Command palette navega y busca.
- Favoritos y recientes funcionan si son viables.
- Bulk actions y densidad de tablas funcionan.
- Dark mode esta pulido si se activa.

Fase 8:

- Arquitectura permite migracion a cloud.
- IA futura tiene documento y boundaries.
- Backups/restores estan endurecidos.
- Empaquetado Mac evaluado.

## 10. Riesgos tecnicos

- Alcance demasiado grande: mitigar con fases y DoD.
- SQLite lento con cartera grande: usar indices, paginacion y queries dedicadas.
- Documentos sensibles expuestos: nunca usar `public`; route handlers seguros.
- Reglas duplicadas en UI/scripts: centralizar en `lib/`.
- Imports destructivos: dry-run, backup y reportes.
- UI generica: sistema visual fuerte desde Fase 1.
- Fechas/timezones: usar helpers compartidos y zona default `America/Mexico_City`.
- Dinero: guardar cantidades como decimal Prisma y formatear con helpers.

## 11. Decisiones arquitectonicas

- App local primero, sin auth remota.
- SQLite como fuente de verdad inicial.
- Prisma como unica puerta a la DB.
- Server Components para lecturas.
- Client Components solo para interaccion.
- shadcn/ui como base, componentes de dominio propios encima.
- Recharts para graficas simples y limpias.
- Framer Motion solo para microinteracciones con proposito.
- Scripts seguros como interfaz de operacion para Codex.

## 12. Fuera del MVP

- IA, OCR, embeddings y busqueda semantica.
- Cloud sync.
- Supabase, Vercel o servicios remotos.
- Multiusuario y permisos avanzados.
- Integraciones con aseguradoras.
- App movil nativa.
- WhatsApp/SMS/email automatico.
- Contabilidad avanzada.

## 13. Preparacion para IA futura

Futuro posible:

- `DocumentText` para texto extraido.
- Chunks por documento.
- Busqueda lexical/semantica.
- Propuestas de campos desde PDF.
- Revision humana obligatoria.
- ActivityLog para sugerencias aceptadas/rechazadas.

Regla central:

- IA sugiere; el usuario aprueba; Prisma guarda.
- IA nunca calcula vencimientos, renovaciones, comisiones ni estados financieros criticos.

## 14. Preparacion para cloud futura

- Mantener queries aisladas en `lib/`.
- Evitar rutas absolutas dispersas.
- Preparar settings para mover documentos a storage privado.
- Mantener import/export robusto.
- Prisma facilita migracion futura a Postgres.
- No introducir dependencias cloud en MVP.

## 15. Criterios visuales premium

PolicyDesk debe sentirse como:

- Cockpit financiero.
- CRM moderno.
- Sistema operativo de cartera.
- Herramienta diaria de decision.

Lineamientos:

- Modo claro principal.
- Paleta neutra, elegante, con acentos sobrios.
- Jerarquia visual fuerte.
- Mucho aire.
- Cards expresivas, no plasticas.
- Tablas profesionales con filtros visibles.
- Badges consistentes.
- Charts que respondan preguntas reales.
- Empty states utiles.
- Skeletons y transiciones suaves.
- Drawers para detalle sin perder contexto.
- Nada de colores chillones ni layouts de ERP viejo.

