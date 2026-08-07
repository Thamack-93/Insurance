"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
import { bulkUpdatePolicyStatus } from "@/app/(dashboard)/policies/actions";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

export type PolicyListRow = {
  id: string;
  policyNumber: string;
  clientId: string;
  clientName: string;
  insurerName: string;
  policyType: string;
  status: string;
  currency: string;
  premiumAmount: number;
  /** Already formatted on the server so the timezone matches the rest of the app. */
  endDateLabel: string;
  daysToRenewal: number | null;
};

export type PoliciesListTableProps = {
  policies: PolicyListRow[];
  page: number;
  pageSize: number;
  total: number;
  searchParams?: Record<string, string | undefined>;
  historical?: boolean;
  /** Bulk status changes are only offered when the viewer may edit policies. */
  canBulkEdit?: boolean;
};

export function PoliciesListTable({
  policies,
  page,
  pageSize,
  total,
  searchParams = {},
  historical = false,
  canBulkEdit = false,
}: PoliciesListTableProps) {
  return (
    <BulkActionsProvider>
      {canBulkEdit ? <PoliciesBulkToolbar policies={policies} /> : null}
      <PoliciesCards policies={policies} selectable={canBulkEdit} historical={historical} />
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {canBulkEdit ? <TableHead className="w-10" /> : null}
              <SortableTableHead sortKey="policyNumber">Póliza</SortableTableHead>
              <SortableTableHead sortKey="client">Cliente</SortableTableHead>
              <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
              <SortableTableHead sortKey="type">Tipo</SortableTableHead>
              <SortableTableHead sortKey="endDate">{historical ? "Fin de vigencia" : "Renovación"}</SortableTableHead>
              <SortableTableHead sortKey="premiumAmount" className="text-right">
                Prima
              </SortableTableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} selectable={canBulkEdit} historical={historical} />
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/policies"
        searchParams={searchParams}
      />
    </BulkActionsProvider>
  );
}

function PoliciesBulkToolbar({ policies }: { policies: PolicyListRow[] }) {
  return (
    <BulkActionsToolbar
      allIds={policies.map((policy) => policy.id)}
      noun={["póliza", "pólizas"]}
      gender="f"
      actions={[
        {
          key: "expire",
          label: "Marcar vencidas",
          confirmTitle: (count) => `¿Marcar ${count} póliza${count !== 1 ? "s" : ""} como expirada${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Las pólizas seleccionadas cambiarán a “Expirada”. Las que ya tengan ese estado o estén fuera de tu cartera se omiten.",
          confirmLabel: "Marcar expiradas",
          run: (ids) => bulkUpdatePolicyStatus(ids, "EXPIRED"),
        },
        {
          key: "cancel",
          label: "Cancelar",
          destructive: true,
          confirmTitle: (count) => `¿Cancelar ${count} póliza${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Las pólizas seleccionadas cambiarán a “Cancelada”. Sus recibos y comisiones no se modifican.",
          confirmLabel: "Cancelar pólizas",
          run: (ids) => bulkUpdatePolicyStatus(ids, "CANCELLED"),
        },
      ]}
    />
  );
}

function renewalLabel(policy: PolicyListRow, historical = false) {
  if (!policy.endDateLabel) return "Sin fecha";
  if (historical) return policy.endDateLabel;
  return policy.daysToRenewal === null
    ? policy.endDateLabel
    : `${policy.endDateLabel} · ${policy.daysToRenewal} días`;
}

function PolicyRow({ policy, selectable, historical }: { policy: PolicyListRow; selectable: boolean; historical: boolean }) {
  const { selectedItems, toggleItem } = useBulkActions();

  return (
    <TableRow data-state={selectedItems.has(policy.id) ? "selected" : undefined}>
      {selectable ? (
        <TableCell>
          <Checkbox
            checked={selectedItems.has(policy.id)}
            onCheckedChange={() => toggleItem(policy.id)}
            aria-label={`Seleccionar póliza ${policy.policyNumber}`}
          />
        </TableCell>
      ) : null}
      <TableCell>
        <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
          {policy.policyNumber}
        </Link>
      </TableCell>
      <TableCell>
        <Link href={`/clients/${policy.clientId}`} className="text-foreground hover:text-primary">
          {policy.clientName}
        </Link>
      </TableCell>
      <TableCell>{policy.insurerName}</TableCell>
      <TableCell>
        <Badge variant="outline" className="rounded-full">
          {policyTypeLabel(policy.policyType)}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">{renewalLabel(policy, historical)}</span>
      </TableCell>
      <TableCell className="text-right font-medium">
        {formatCurrency(policy.premiumAmount, policy.currency)}
      </TableCell>
      <TableCell>
        <StatusBadge status={policy.status} entity="policy" />
      </TableCell>
    </TableRow>
  );
}

function PoliciesCards({ policies, selectable, historical }: { policies: PolicyListRow[]; selectable: boolean; historical: boolean }) {
  const { selectedItems, toggleItem } = useBulkActions();

  const items: RecordCardItem[] = policies.map((policy) => ({
    id: policy.id,
    title: policy.policyNumber,
    href: `/policies/${policy.id}`,
    subtitle: `${policy.clientName} · ${policy.insurerName}`,
    badge: <StatusBadge status={policy.status} entity="policy" />,
    leading: selectable ? (
      <Checkbox
        checked={selectedItems.has(policy.id)}
        onCheckedChange={() => toggleItem(policy.id)}
        aria-label={`Seleccionar póliza ${policy.policyNumber}`}
      />
    ) : undefined,
    fields: [
      { label: "Prima", value: formatCurrency(policy.premiumAmount, policy.currency), emphasis: true },
      { label: historical ? "Fin de vigencia" : "Renovación", value: renewalLabel(policy, historical) },
      { label: "Tipo", value: policyTypeLabel(policy.policyType) },
    ],
  }));

  return <RecordCards items={items} label="Pólizas" />;
}
