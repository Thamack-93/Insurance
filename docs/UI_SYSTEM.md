# PolicyDesk UI System

## Direccion visual

PolicyDesk debe sentirse como un cockpit financiero premium para seguros. La interfaz debe ser sobria, elegante, luminosa y operativa.

Inspiracion:

- Linear
- Attio
- Stripe Dashboard
- Vercel Dashboard
- HubSpot moderno
- Notion moderno, pero mas visual

## Principios

- High signal, low noise.
- Acciones visibles, ruido oculto.
- Jerarquia editorial.
- Tablas profesionales, no hojas de calculo crudas.
- Cards con proposito.
- Charts limpios y legibles.
- Empty states accionables.

## Layout

- Sidebar fija y colapsable.
- Topbar con busqueda global.
- Breadcrumbs.
- Header contextual por pagina.
- Filtros sticky en vistas operativas.
- Drawers para inspeccion rapida.
- Detail pages para profundidad.

## Paleta

- Base clara y neutra.
- Fondos calidos muy sutiles.
- Texto principal fuerte.
- Texto secundario gris elegante.
- Acentos sobrios: azul petrol, verde financiero, amber operativo, rojo critico.
- Evitar colores chillones.

## Componentes

Core:

- `KpiCard`
- `StatusBadge`
- `PriorityBadge`
- `DataTable`
- `DetailDrawer`
- `ConfirmDialog`
- `EmptyState`
- `LoadingSkeleton`
- `ActivityTimeline`
- `DocumentCard`
- `RiskAlertCard`
- `QuickActionButton`
- `ChartCard`
- `StatGrid`

## Badges

Estados positivos:

- Activo
- Pagado
- Renovado
- Resuelto
- Cobrado

Estados neutrales:

- Pendiente
- En proceso
- Por cobrar

Estados de espera:

- Esperando cliente
- Esperando aseguradora
- Esperando documento

Estados negativos:

- Vencido
- Cancelado
- Archivado

## Tablas

Requisitos:

- Sticky headers.
- Hover states elegantes.
- Smart row highlighting.
- Toggle compacta/comoda.
- Bulk actions.
- Columnas importantes siempre visibles.
- Filtros por chips.
- Drawer al hacer click en fila.
- Links para cliente y poliza.

## Motion

Usar Framer Motion con moderacion:

- Entrada suave de cards.
- Stagger sutil en dashboards.
- Drawer con transicion limpia.
- Hover de acciones.
- No animaciones decorativas que estorben.

## Empty states

Cada empty state debe decir:

- Que no hay.
- Por que importa.
- Que accion tomar.

## Criterio de rechazo visual

La UI no esta lista si:

- Parece plantilla generica.
- Todo es una tabla gigante.
- No hay jerarquia.
- Los colores gritan.
- Los KPIs no invitan a actuar.
- Las pantallas no responden "que hago ahora".

