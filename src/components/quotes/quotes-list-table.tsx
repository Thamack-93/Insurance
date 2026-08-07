"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/badges/status-badge";
import { Pagination } from "@/components/lists/pagination";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import { RecordCards, type RecordCardItem } from "@/components/tables/record-cards";
import {
  BulkActionsProvider,
  useBulkActions,
} from "@/components/bulk-actions/bulk-actions-provider";
import { BulkActionsToolbar } from "@/components/bulk-actions/bulk-actions-toolbar";
import { bulkUpdateQuoteStatus } from "@/app/(dashboard)/quotes/actions";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

export type QuoteListRow = {
  id: string;
  folio: string;
  clientName: string;
  policyType: string;
  insurerName: string;
  status: string;
  /** Already formatted on the server so the timezone matches the rest of the app. */
  createdAtLabel: string;
  daysSinceCreated: number;
  quotedAmount: number | null;
};

export type QuotesListTableProps = {
  quotes: QuoteListRow[];
  page: number;
  pageSize: number;
  total: number;
  searchParams?: Record<string, string | undefined>;
};

export function QuotesListTable({ quotes, page, pageSize, total, searchParams = {} }: QuotesListTableProps) {
  return (
    <BulkActionsProvider>
      <QuotesBulkToolbar quotes={quotes} />
      <QuotesCards quotes={quotes} />
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10" />
              <SortableTableHead sortKey="folio">Folio</SortableTableHead>
              <SortableTableHead sortKey="client">Cliente</SortableTableHead>
              <SortableTableHead sortKey="type">Tipo</SortableTableHead>
              <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
              <SortableTableHead sortKey="status">Estado</SortableTableHead>
              <SortableTableHead sortKey="createdAt">Creada</SortableTableHead>
              <SortableTableHead sortKey="value" className="text-right">
                Prima
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((quote) => (
              <QuoteRow key={quote.id} quote={quote} />
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/quotes"
        searchParams={searchParams}
      />
    </BulkActionsProvider>
  );
}

function QuotesBulkToolbar({ quotes }: { quotes: QuoteListRow[] }) {
  return (
    <BulkActionsToolbar
      allIds={quotes.map((quote) => quote.id)}
      noun={["cotización", "cotizaciones"]}
      gender="f"
      actions={[
        {
          key: "sent",
          label: "Marcar enviadas",
          confirmTitle: (count) => `¿Marcar ${count} cotización${count !== 1 ? "es" : ""} como enviada${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Se registrará que la propuesta ya salió al cliente. Las cotizaciones aceptadas se omiten.",
          confirmLabel: "Marcar enviadas",
          run: (ids) => bulkUpdateQuoteStatus(ids, "SENT"),
        },
        {
          key: "rejected",
          label: "Marcar rechazadas",
          confirmTitle: (count) => `¿Marcar ${count} cotización${count !== 1 ? "es" : ""} como rechazada${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Saldrán del embudo activo. Las cotizaciones aceptadas se omiten.",
          confirmLabel: "Marcar rechazadas",
          destructive: true,
          run: (ids) => bulkUpdateQuoteStatus(ids, "REJECTED"),
        },
        {
          key: "expired",
          label: "Marcar expiradas",
          confirmTitle: (count) => `¿Marcar ${count} cotización${count !== 1 ? "es" : ""} como expirada${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Úsalo para limpiar propuestas fuera de vigencia. Las cotizaciones aceptadas se omiten.",
          confirmLabel: "Marcar expiradas",
          run: (ids) => bulkUpdateQuoteStatus(ids, "EXPIRED"),
        },
      ]}
    />
  );
}

function QuoteRow({ quote }: { quote: QuoteListRow }) {
  const { selectedItems, toggleItem } = useBulkActions();

  return (
    <TableRow data-state={selectedItems.has(quote.id) ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selectedItems.has(quote.id)}
          onCheckedChange={() => toggleItem(quote.id)}
          aria-label={`Seleccionar cotización ${quote.folio}`}
        />
      </TableCell>
      <TableCell>
        <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary">
          {quote.folio}
        </Link>
      </TableCell>
      <TableCell>{quote.clientName}</TableCell>
      <TableCell>{policyTypeLabel(quote.policyType)}</TableCell>
      <TableCell>{quote.insurerName || "—"}</TableCell>
      <TableCell>
        <StatusBadge status={quote.status} entity="quote" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="size-3" />
          {quote.createdAtLabel}
          <span className="text-xs">({quote.daysSinceCreated} d)</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-medium">
        {quote.quotedAmount === null ? "—" : formatCurrency(quote.quotedAmount)}
      </TableCell>
    </TableRow>
  );
}

function QuotesCards({ quotes }: { quotes: QuoteListRow[] }) {
  const { selectedItems, toggleItem } = useBulkActions();

  const items: RecordCardItem[] = quotes.map((quote) => ({
    id: quote.id,
    title: quote.folio,
    href: `/quotes/${quote.id}`,
    subtitle: `${quote.clientName} · ${policyTypeLabel(quote.policyType)}`,
    badge: <StatusBadge status={quote.status} entity="quote" />,
    leading: (
      <Checkbox
        checked={selectedItems.has(quote.id)}
        onCheckedChange={() => toggleItem(quote.id)}
        aria-label={`Seleccionar cotización ${quote.folio}`}
      />
    ),
    fields: [
      {
        label: "Prima",
        value: quote.quotedAmount === null ? "—" : formatCurrency(quote.quotedAmount),
        emphasis: true,
      },
      { label: "Creada", value: `${quote.createdAtLabel} (${quote.daysSinceCreated} d)` },
      { label: "Aseguradora", value: quote.insurerName || "—" },
    ],
  }));

  return <RecordCards items={items} label="Cotizaciones" />;
}
