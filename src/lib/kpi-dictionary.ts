export type KpiDefinition = {
  key: string;
  etiqueta: string;
  definicion: string;
  ruta: string;
  categoria: "Portafolio" | "Cobranza" | "Renovaciones" | "Operación" | "Comisiones" | "Calidad";
};

export const KPI_DICTIONARY: Record<string, KpiDefinition> = {
  primaTotal: {
    key: "primaTotal",
    etiqueta: "Prima total",
    definicion: "Suma de la prima vigente del portafolio en el corte actual.",
    ruta: "/portfolio",
    categoria: "Portafolio",
  },
  polizasActivas: {
    key: "polizasActivas",
    etiqueta: "Pólizas activas",
    definicion: "Número de pólizas en estado activo.",
    ruta: "/portfolio",
    categoria: "Portafolio",
  },
  distribucionAseguradoras: {
    key: "distribucionAseguradoras",
    etiqueta: "Distribución por aseguradora",
    definicion: "Reparto del portafolio por aseguradora, ordenado por prima total.",
    ruta: "/portfolio",
    categoria: "Portafolio",
  },
  distribucionTipos: {
    key: "distribucionTipos",
    etiqueta: "Distribución por tipo",
    definicion: "Reparto del portafolio por tipo de póliza.",
    ruta: "/portfolio",
    categoria: "Portafolio",
  },
  clientesConMasPolizas: {
    key: "clientesConMasPolizas",
    etiqueta: "Clientes con más pólizas",
    definicion: "Ranking de clientes con mayor número de pólizas registradas.",
    ruta: "/portfolio",
    categoria: "Portafolio",
  },
  saludDatos: {
    key: "saludDatos",
    etiqueta: "Salud de datos",
    definicion: "Indicador de completitud y consistencia del portafolio.",
    ruta: "/risks?tab=completitud",
    categoria: "Calidad",
  },
  pagosPorVencer: {
    key: "pagosPorVencer",
    etiqueta: "Pagos por vencer",
    definicion: "Recibos pendientes o vencidos dentro del rango configurado.",
    ruta: "/receipts?tab=cobrar",
    categoria: "Cobranza",
  },
  renovacionesPendientes: {
    key: "renovacionesPendientes",
    etiqueta: "Renovaciones pendientes",
    definicion: "Pólizas con fecha de renovación dentro del rango consultado.",
    ruta: "/renewals",
    categoria: "Renovaciones",
  },
  tareasAbiertas: {
    key: "tareasAbiertas",
    etiqueta: "Tareas abiertas",
    definicion: "Pendientes abiertos que requieren seguimiento operativo.",
    ruta: "/tasks",
    categoria: "Operación",
  },
  resumenComisiones: {
    key: "resumenComisiones",
    etiqueta: "Resumen de comisiones",
    definicion: "Monto esperado, cobrado y saldo pendiente de comisiones.",
    ruta: "/commissions",
    categoria: "Comisiones",
  },
  calidadClientes: {
    key: "calidadClientes",
    etiqueta: "Calidad de clientes",
    definicion: "Puntaje de completitud por cliente.",
    ruta: "/risks?tab=completitud",
    categoria: "Calidad",
  },
  calidadPolizas: {
    key: "calidadPolizas",
    etiqueta: "Calidad de pólizas",
    definicion: "Puntaje de completitud por póliza.",
    ruta: "/risks?tab=completitud",
    categoria: "Calidad",
  },
};

export const KPI_LIST = Object.values(KPI_DICTIONARY);
