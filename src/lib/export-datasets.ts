import "server-only";

import { getDb } from "@/lib/db";
import { requirePortfolioReadScope } from "@/lib/portfolio-access";
import { formatDate } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { policyTypeLabel, statusLabel } from "@/lib/status";
import type { ExportColumn } from "@/lib/export";
import type { TableSearchParams } from "@/lib/table-query";
import {
  buildClientListOrderBy,
  buildClientListWhere,
  buildPolicyListOrderBy,
  buildPolicyListWhere,
  buildQuoteListOrderBy,
  buildQuoteListWhere,
  buildReceiptListOrderBy,
  buildReceiptListWhere,
  readClientListFilters,
  readPolicyListFilters,
  readQuoteListFilters,
  readReceiptListFilters,
} from "@/lib/list-filters";

/**
 * Server-side datasets behind the "Exportar" menu.
 *
 * Every dataset resolves the portfolio scope itself and reuses the exact same
 * filter builders as the screen it belongs to, so an export can never reach
 * beyond what the user is allowed to see, and it always covers the whole
 * filtered result set rather than the page on screen.
 */

/** Guard rail so a careless export cannot try to materialise the whole database. */
export const EXPORT_ROW_LIMIT = 5000;

export type ExportDatasetResult = {
  sheetName: string;
  fileBaseName: string;
  columns: Array<ExportColumn<Record<string, unknown>>>;
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
};

type ExportDataset = {
  label: string;
  load: (params: TableSearchParams) => Promise<ExportDatasetResult>;
};

function columns<T extends Record<string, unknown>>(
  definitions: Array<{ clave: keyof T & string; etiqueta: string }>,
) {
  return definitions as Array<ExportColumn<Record<string, unknown>>>;
}

const clientsDataset: ExportDataset = {
  label: "Clientes",
  async load(params) {
    const scope = await requirePortfolioReadScope();
    const filters = readClientListFilters(params);
    const db = getDb();

    const records = await db.client.findMany({
      where: buildClientListWhere(filters, scope.portfolioOwnerId, scope.organizationId),
      orderBy: buildClientListOrderBy(filters),
      include: { _count: { select: { policies: true, receipts: true, tasks: true } } },
      take: EXPORT_ROW_LIMIT + 1,
    });

    const truncated = records.length > EXPORT_ROW_LIMIT;

    return {
      sheetName: "Clientes",
      fileBaseName: "clientes",
      truncated,
      columns: columns([
        { clave: "nombre", etiqueta: "Cliente" },
        { clave: "tipo", etiqueta: "Tipo" },
        { clave: "email", etiqueta: "Email" },
        { clave: "telefono", etiqueta: "Teléfono" },
        { clave: "rfc", etiqueta: "RFC" },
        { clave: "polizas", etiqueta: "Pólizas" },
        { clave: "recibos", etiqueta: "Recibos" },
        { clave: "tareas", etiqueta: "Tareas" },
        { clave: "alta", etiqueta: "Alta" },
        { clave: "estado", etiqueta: "Estado" },
      ]),
      rows: records.slice(0, EXPORT_ROW_LIMIT).map((client) => ({
        nombre: client.fullName,
        tipo: client.type === "COMPANY" ? "Empresa" : "Persona",
        email: client.email ?? "",
        telefono: client.phone ?? "",
        rfc: client.rfc ?? "",
        polizas: client._count.policies,
        recibos: client._count.receipts,
        tareas: client._count.tasks,
        alta: formatDate(client.createdAt),
        estado: statusLabel(client.status, "client"),
      })),
    };
  },
};

const policiesDataset: ExportDataset = {
  label: "Pólizas",
  async load(params) {
    const scope = await requirePortfolioReadScope();
    const filters = readPolicyListFilters(params);
    const db = getDb();

    const records = await db.policy.findMany({
      where: buildPolicyListWhere(filters, scope.portfolioOwnerId, scope.organizationId),
      orderBy: buildPolicyListOrderBy(filters),
      include: { client: true, insurer: true },
      take: EXPORT_ROW_LIMIT + 1,
    });

    const truncated = records.length > EXPORT_ROW_LIMIT;

    return {
      sheetName: "Pólizas",
      fileBaseName: "polizas",
      truncated,
      columns: columns([
        { clave: "poliza", etiqueta: "Póliza" },
        { clave: "cliente", etiqueta: "Cliente" },
        { clave: "aseguradora", etiqueta: "Aseguradora" },
        { clave: "tipo", etiqueta: "Tipo" },
        { clave: "inicio", etiqueta: "Inicio" },
        { clave: "renovacion", etiqueta: "Renovación" },
        { clave: "prima", etiqueta: "Prima" },
        { clave: "moneda", etiqueta: "Moneda" },
        { clave: "estado", etiqueta: "Estado" },
      ]),
      rows: records.slice(0, EXPORT_ROW_LIMIT).map((policy) => ({
        poliza: policy.policyNumber,
        cliente: policy.client.fullName,
        aseguradora: policy.insurer.name,
        tipo: policyTypeLabel(policy.policyType),
        inicio: policy.startDate ? formatDate(policy.startDate) : "",
        renovacion: policy.endDate ? formatDate(policy.endDate) : "",
        prima: toNumber(policy.premiumAmount),
        moneda: policy.currency,
        estado: statusLabel(policy.status, "policy"),
      })),
    };
  },
};

const receiptsDataset: ExportDataset = {
  label: "Recibos",
  async load(params) {
    const scope = await requirePortfolioReadScope();
    const filters = readReceiptListFilters(params);
    const db = getDb();

    const records = await db.receipt.findMany({
      where: buildReceiptListWhere(filters, scope.portfolioOwnerId, scope.organizationId),
      orderBy: buildReceiptListOrderBy(filters),
      include: { client: true, policy: true, insurer: true, endorsement: true },
      take: EXPORT_ROW_LIMIT + 1,
    });

    const truncated = records.length > EXPORT_ROW_LIMIT;

    return {
      sheetName: "Recibos",
      fileBaseName: "recibos",
      truncated,
      columns: columns([
        { clave: "recibo", etiqueta: "Recibo" },
        { clave: "cliente", etiqueta: "Cliente" },
        { clave: "poliza", etiqueta: "Póliza" },
        { clave: "aseguradora", etiqueta: "Aseguradora" },
        { clave: "endoso", etiqueta: "Endoso" },
        { clave: "vencimiento", etiqueta: "Vencimiento" },
        { clave: "monto", etiqueta: "Monto" },
        { clave: "moneda", etiqueta: "Moneda" },
        { clave: "estado", etiqueta: "Estado" },
      ]),
      rows: records.slice(0, EXPORT_ROW_LIMIT).map((receipt) => ({
        recibo: receipt.receiptNumber,
        cliente: receipt.client?.fullName ?? "",
        poliza: receipt.policy?.policyNumber ?? "",
        aseguradora: receipt.insurer?.name ?? "",
        endoso: receipt.endorsement?.endorsementNumber ?? "",
        vencimiento: formatDate(receipt.dueDate),
        monto: toNumber(receipt.amount),
        moneda: receipt.currency,
        estado: statusLabel(receipt.status, "receipt"),
      })),
    };
  },
};

const quotesDataset: ExportDataset = {
  label: "Cotizaciones",
  async load(params) {
    const scope = await requirePortfolioReadScope();
    const filters = readQuoteListFilters(params);
    const db = getDb();

    const records = await db.quote.findMany({
      where: buildQuoteListWhere(filters, scope.portfolioOwnerId, scope.organizationId),
      orderBy: buildQuoteListOrderBy(filters),
      include: { client: true, insurer: true },
      take: EXPORT_ROW_LIMIT + 1,
    });

    const truncated = records.length > EXPORT_ROW_LIMIT;

    return {
      sheetName: "Cotizaciones",
      fileBaseName: "cotizaciones",
      truncated,
      columns: columns([
        { clave: "folio", etiqueta: "Folio" },
        { clave: "cliente", etiqueta: "Cliente" },
        { clave: "tipo", etiqueta: "Tipo" },
        { clave: "aseguradora", etiqueta: "Aseguradora" },
        { clave: "estado", etiqueta: "Estado" },
        { clave: "creada", etiqueta: "Creada" },
        { clave: "vigencia", etiqueta: "Vigente hasta" },
        { clave: "prima", etiqueta: "Prima" },
      ]),
      rows: records.slice(0, EXPORT_ROW_LIMIT).map((quote) => ({
        folio: quote.id.slice(0, 8),
        cliente: quote.client.fullName,
        tipo: policyTypeLabel(quote.policyType),
        aseguradora: quote.insurer?.name ?? "",
        estado: statusLabel(quote.status, "quote"),
        creada: formatDate(quote.createdAt),
        vigencia: quote.validUntil ? formatDate(quote.validUntil) : "",
        prima: quote.quotedAmount === null ? "" : toNumber(quote.quotedAmount),
      })),
    };
  },
};

export const EXPORT_DATASETS = {
  clients: clientsDataset,
  policies: policiesDataset,
  receipts: receiptsDataset,
  quotes: quotesDataset,
} satisfies Record<string, ExportDataset>;

export type ExportDatasetKey = keyof typeof EXPORT_DATASETS;

export function isExportDatasetKey(value: string): value is ExportDatasetKey {
  return Object.hasOwn(EXPORT_DATASETS, value);
}
