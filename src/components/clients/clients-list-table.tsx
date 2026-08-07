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
import { formatDate } from "@/lib/dates";
import { bulkArchiveClients } from "@/app/(dashboard)/clients/actions";

export type ClientListRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  type: string;
  status: string;
  createdAt: string;
  _count: { policies: number; receipts: number; tasks: number };
};

type ClientsListTableProps = {
  clients: ClientListRow[];
  page: number;
  pageSize: number;
  total: number;
  query: string;
  searchParams?: Record<string, string | undefined>;
  /** Archiving is admin-only; hide the affordance for everyone else. */
  canBulkEdit?: boolean;
};

function typeLabel(type: string) {
  return type === "COMPANY" ? "Empresa" : "Persona";
}

export function ClientsListTable({
  clients,
  page,
  pageSize,
  total,
  query,
  searchParams = {},
  canBulkEdit = false,
}: ClientsListTableProps) {
  return (
    <BulkActionsProvider>
      {canBulkEdit ? <ClientsBulkToolbar clients={clients} /> : null}
      <ClientsCards clients={clients} selectable={canBulkEdit} />
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {canBulkEdit ? <TableHead className="w-10" /> : null}
              <SortableTableHead sortKey="fullName">Cliente</SortableTableHead>
              <SortableTableHead sortKey="type">Tipo</SortableTableHead>
              <TableHead className="text-right">Pólizas</TableHead>
              <TableHead className="text-right">Recibos</TableHead>
              <TableHead className="text-right">Tareas</TableHead>
              <SortableTableHead sortKey="createdAt">Alta</SortableTableHead>
              <SortableTableHead sortKey="status">Estado</SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <ClientRow key={client.id} client={client} selectable={canBulkEdit} />
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/clients"
        searchParams={{ q: query, ...searchParams }}
      />
    </BulkActionsProvider>
  );
}

function ClientsBulkToolbar({ clients }: { clients: ClientListRow[] }) {
  return (
    <BulkActionsToolbar
      allIds={clients.map((client) => client.id)}
      noun={["cliente", "clientes"]}
      actions={[
        {
          key: "archive",
          label: "Archivar",
          confirmTitle: (count) => `¿Archivar ${count} cliente${count !== 1 ? "s" : ""}?`,
          confirmDescription: () =>
            "Pasarán a estado “Inactivo” y dejarán de aparecer en las vistas activas. Sus pólizas, recibos y tareas se conservan.",
          confirmLabel: "Archivar",
          run: (ids) => bulkArchiveClients(ids),
        },
      ]}
    />
  );
}

function ClientRow({ client, selectable }: { client: ClientListRow; selectable: boolean }) {
  const { selectedItems, toggleItem } = useBulkActions();

  return (
    <TableRow data-state={selectedItems.has(client.id) ? "selected" : undefined}>
      {selectable ? (
        <TableCell>
          <Checkbox
            checked={selectedItems.has(client.id)}
            onCheckedChange={() => toggleItem(client.id)}
            aria-label={`Seleccionar ${client.fullName}`}
          />
        </TableCell>
      ) : null}
      <TableCell>
        <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:text-primary">
          {client.fullName}
        </Link>
        <p className="text-xs text-muted-foreground">
          {client.email ?? "Sin email"} · {client.phone ?? "Sin teléfono"}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="rounded-full">
          {typeLabel(client.type)}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{client._count.policies}</TableCell>
      <TableCell className="text-right">{client._count.receipts}</TableCell>
      <TableCell className="text-right">{client._count.tasks}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(new Date(client.createdAt))}</TableCell>
      <TableCell>
        <StatusBadge status={client.status} entity="client" />
      </TableCell>
    </TableRow>
  );
}

function ClientsCards({ clients, selectable }: { clients: ClientListRow[]; selectable: boolean }) {
  const { selectedItems, toggleItem } = useBulkActions();

  const items: RecordCardItem[] = clients.map((client) => ({
    id: client.id,
    title: client.fullName,
    href: `/clients/${client.id}`,
    subtitle: `${typeLabel(client.type)} · ${client.email ?? client.phone ?? "Sin contacto"}`,
    badge: <StatusBadge status={client.status} entity="client" />,
    leading: selectable ? (
      <Checkbox
        checked={selectedItems.has(client.id)}
        onCheckedChange={() => toggleItem(client.id)}
        aria-label={`Seleccionar ${client.fullName}`}
      />
    ) : undefined,
    fields: [
      { label: "Pólizas", value: client._count.policies, emphasis: true },
      { label: "Recibos", value: client._count.receipts },
      { label: "Tareas", value: client._count.tasks },
      { label: "Alta", value: formatDate(new Date(client.createdAt)) },
    ],
  }));

  return <RecordCards items={items} label="Clientes" />;
}
