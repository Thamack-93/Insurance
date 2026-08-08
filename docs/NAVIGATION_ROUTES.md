# Rutas de navegación

Las rutas canónicas se mantienen separadas de las rutas heredadas. Las vistas funcionales que pertenecen a una sección se exponen mediante navegación local y no se registran como alias de redirección del sidebar.

| Sección | Ruta canónica | Entrada visible | Ruta heredada |
| --- | --- | --- | --- |
| Pólizas | `/policies` | Sidebar y navegación local | — |
| Cotizaciones | `/quotes` | Navegación local de Pólizas, paleta y `g` → `q` | — |
| Reportes | `/reports` | Sidebar y navegación local | — |
| Cartera | `/portfolio` | Navegación local de Reportes y paleta | — |
| Reporte de cartera | `/reports?view=portfolio` | Navegación local de Reportes | — |
| Hoy | `/today` | Sidebar y navegación local | `/dashboard` → `/today?view=insights` |
| Insights | `/today?view=insights` | Navegación local de Hoy, paleta y `g` → `d` | — |

Las rutas heredadas de operación y cobranza (`/tasks`, `/renewals`, `/claims` y `/due-payments`) conservan sus redirecciones canónicas existentes.
