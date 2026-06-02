import { endOfDay, startOfDay } from "date-fns";
import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { policyTypeLabel, statusLabels } from "@/lib/status";
import { commissionPortfolioWhere, policyPortfolioWhere, requirePortfolioUser } from "@/lib/portfolio-access";

type CommissionStatus = "EXPECTED" | "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

export type PortfolioMetricItem = {
  id: string;
  nombre: string;
  totalPolizas: number;
  primaTotal: number;
};

export type PortfolioClientItem = {
  clienteId: string;
  cliente: string;
  totalPolizas: number;
  polizasActivas: number;
  primaTotal: number;
};

export type PortfolioHealth = {
  score: number;
  clientesCompletos: number;
  clientesConDatosBasicos: number;
  polizasConVencimiento: number;
  polizasConPDF: number;
  polizasConObjetoAsegurado: number;
  totalClientes: number;
  totalPolizas: number;
};

export type PortfolioMetrics = {
  fechaCorte: Date;
  primaTotal: number;
  polizasActivas: number;
  distribucionAseguradoras: PortfolioMetricItem[];
  distribucionTipos: Array<PortfolioMetricItem & { tipo: string }>;
  clientesConMasPolizas: PortfolioClientItem[];
  saludDatos: PortfolioHealth;
};

export type CommissionSummaryOptions = {
  from?: Date;
  to?: Date;
};

export type CommissionStateSummary = {
  estado: CommissionStatus;
  etiqueta: string;
  cantidad: number;
  montoEsperado: number;
  montoCobrado: number;
  saldoPendiente: number;
};

export type CommissionInsurerSummary = {
  aseguradoraId: string;
  aseguradora: string;
  cantidad: number;
  montoEsperado: number;
  montoCobrado: number;
  saldoPendiente: number;
};

export type CommissionSummary = {
  rango: {
    desde: Date;
    hasta: Date;
  };
  cantidad: number;
  montoEsperado: number;
  montoCobrado: number;
  saldoPendiente: number;
  porEstado: CommissionStateSummary[];
  porAseguradora: CommissionInsurerSummary[];
};

export async function getPortfolioMetrics() {
  const db = getDb();
  const user = await requirePortfolioUser();
  const fechaCorte = today();
  const policyWhere = policyPortfolioWhere(user.id);

  const [clients, policies] = await Promise.all([
    db.client.findMany({
      where: { portfolioOwnerId: user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
      },
    }),
    db.policy.findMany({
      where: policyWhere,
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        status: true,
        premiumAmount: true,
        endDate: true,
        insuredObject: true,
        clientId: true,
        client: { select: { fullName: true } },
        insurerId: true,
        insurer: { select: { name: true } },
        documents: {
          where: { documentType: "POLICY" },
          select: { id: true },
        },
      },
    }),
  ]);

  const activePolicies = policies.filter((policy) => policy.status === "ACTIVE");
  const primaTotal = activePolicies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);

  const insurerBuckets = new Map<string, PortfolioMetricItem>();
  const typeBuckets = new Map<string, PortfolioMetricItem & { tipo: string }>();
  const clientBuckets = new Map<string, PortfolioClientItem>();

  for (const policy of activePolicies) {
    const amount = toNumber(policy.premiumAmount);

    const insurerKey = policy.insurerId;
    const currentInsurer =
      insurerBuckets.get(insurerKey) ?? {
        id: insurerKey,
        nombre: policy.insurer.name,
        totalPolizas: 0,
        primaTotal: 0,
      };

    currentInsurer.totalPolizas += 1;
    currentInsurer.primaTotal += amount;
    insurerBuckets.set(insurerKey, currentInsurer);

    const typeKey = policy.policyType;
    const currentType =
      typeBuckets.get(typeKey) ?? {
        id: typeKey,
        tipo: typeKey,
        nombre: policyTypeLabel(typeKey),
        totalPolizas: 0,
        primaTotal: 0,
      };

    currentType.totalPolizas += 1;
    currentType.primaTotal += amount;
    typeBuckets.set(typeKey, currentType);

    const clientKey = policy.clientId;
    const currentClient =
      clientBuckets.get(clientKey) ?? {
        clienteId: clientKey,
        cliente: policy.client.fullName,
        totalPolizas: 0,
        polizasActivas: 0,
        primaTotal: 0,
      };

    currentClient.totalPolizas += 1;
    currentClient.primaTotal += amount;
    if (policy.status === "ACTIVE") {
      currentClient.polizasActivas += 1;
    }
    clientBuckets.set(clientKey, currentClient);
  }

  const clientesConDatosBasicos = clients.filter(
    (client) => Boolean(client.email && client.phone && client.address),
  ).length;
  const polizasConVencimiento = policies.filter((policy) => Boolean(policy.endDate)).length;
  const polizasConPDF = policies.filter((policy) => policy.documents.length > 0).length;
  const polizasConObjetoAsegurado = policies.filter((policy) => Boolean(policy.insuredObject?.trim())).length;

  const scoreClientes = clients.length
    ? Math.round((clientesConDatosBasicos / clients.length) * 100)
    : 100;
  const scorePolizas = policies.length
    ? Math.round(
        ((polizasConVencimiento / policies.length) +
          (polizasConPDF / policies.length) +
          (polizasConObjetoAsegurado / policies.length)) /
          3 *
          100,
      )
    : 100;

  const saludDatos: PortfolioHealth = {
    score: Math.round((scoreClientes + scorePolizas) / 2),
    clientesCompletos: clientesConDatosBasicos,
    clientesConDatosBasicos,
    polizasConVencimiento,
    polizasConPDF,
    polizasConObjetoAsegurado,
    totalClientes: clients.length,
    totalPolizas: policies.length,
  };

  return {
    fechaCorte,
    primaTotal,
    polizasActivas: activePolicies.length,
    distribucionAseguradoras: [...insurerBuckets.values()]
      .sort((a, b) => b.primaTotal - a.primaTotal || b.totalPolizas - a.totalPolizas)
      .slice(0, 12),
    distribucionTipos: [...typeBuckets.values()]
      .sort((a, b) => b.primaTotal - a.primaTotal || b.totalPolizas - a.totalPolizas)
      .slice(0, 12),
    clientesConMasPolizas: [...clientBuckets.values()]
      .sort((a, b) => b.totalPolizas - a.totalPolizas || b.primaTotal - a.primaTotal)
      .slice(0, 10),
    saludDatos,
  } satisfies PortfolioMetrics;
}

export async function getCommissionSummary(options: CommissionSummaryOptions = {}) {
  const db = getDb();
  const user = await requirePortfolioUser();
  const rango = resolveRange(options.from, options.to, 60);

  const commissions = await db.commission.findMany({
    where: {
      ...commissionPortfolioWhere(user.id),
      expectedDate: { gte: rango.from, lte: rango.to },
      status: { not: "CANCELLED" },
    },
    include: {
      insurer: { select: { id: true, name: true } },
    },
    orderBy: [{ expectedDate: "asc" }, { createdAt: "asc" }],
  });

  const porEstado = new Map<string, CommissionStateSummary>();
  const porAseguradora = new Map<string, CommissionInsurerSummary>();

  let montoEsperado = 0;
  let montoCobrado = 0;

  for (const commission of commissions) {
    const expected = toNumber(commission.expectedAmount);
    const actual = toNumber(commission.actualAmount);
    const saldo = Math.max(expected - actual, 0);

    montoEsperado += expected;
    montoCobrado += actual;

    const currentState =
      porEstado.get(commission.status) ?? {
        estado: commission.status as CommissionStatus,
        etiqueta: statusLabels[commission.status] ?? commission.status,
        cantidad: 0,
        montoEsperado: 0,
        montoCobrado: 0,
        saldoPendiente: 0,
      };
    currentState.cantidad += 1;
    currentState.montoEsperado += expected;
    currentState.montoCobrado += actual;
    currentState.saldoPendiente += saldo;
    porEstado.set(commission.status, currentState);

    const insurerKey = commission.insurerId;
    const currentInsurer =
      porAseguradora.get(insurerKey) ?? {
        aseguradoraId: insurerKey,
        aseguradora: commission.insurer.name,
        cantidad: 0,
        montoEsperado: 0,
        montoCobrado: 0,
        saldoPendiente: 0,
      };
    currentInsurer.cantidad += 1;
    currentInsurer.montoEsperado += expected;
    currentInsurer.montoCobrado += actual;
    currentInsurer.saldoPendiente += saldo;
    porAseguradora.set(insurerKey, currentInsurer);
  }

  return {
    rango: {
      desde: rango.from,
      hasta: rango.to,
    },
    cantidad: commissions.length,
    montoEsperado,
    montoCobrado,
    saldoPendiente: Math.max(montoEsperado - montoCobrado, 0),
    porEstado: [...porEstado.values()].sort((a, b) => b.montoEsperado - a.montoEsperado),
    porAseguradora: [...porAseguradora.values()].sort((a, b) => b.montoEsperado - a.montoEsperado),
  } satisfies CommissionSummary;
}

function resolveRange(from?: Date, to?: Date, fallbackDays = 60) {
  const inicio = from ? startOfDay(from) : today();
  const fin = to ? endOfDay(to) : endOfDay(new Date(inicio.getTime() + fallbackDays * 24 * 60 * 60 * 1000));

  if (fin < inicio) {
    throw new Error("El rango de fechas es inválido.");
  }

  return {
    from: inicio,
    to: fin,
  };
}
