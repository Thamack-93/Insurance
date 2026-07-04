"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/badges/status-badge";
import { Pagination } from "@/components/lists/pagination";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import {
  BulkActionsProvider,
  useBulkActions,
} from "@/components/bulk-actions/bulk-actions-provider";
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
};

export function ClientsListTable({ clients, page, pageSize, total, query, searchParams = {} }: ClientsListTableProps) {
  return (
    <BulkActionsProvider>
      <ClientsBulkToolbar clients={clients} />
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-10" />
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
            <ClientRow key={client.id} client={client} />
          ))}
        </TableBody>
      </Table>
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { selectedItems, hasSelection, clearSelection, getSelectedIds, selectAll } = useBulkActions();
  const allIds = clients.map((c) => c.id);

  const handleArchive = () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      toast.error("Selecciona al menos un cliente.");
      return;
    }
    startTransition(async () => {
      const result = await bulkArchiveClients(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      clearSelection();
      router.refresh();
    });
  };

  if (clients.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2">
      <Checkbox
        checked={selectedItems.size === clients.length && clients.length > 0}
        onCheckedChange={(checked) => (checked ? selectAll(allIds) : clearSelection())}
        aria-label="Seleccionar todos los clientes de la página"
      />
      {hasSelection ? (
        <>
          <span className="text-sm text-muted-foreground">{selectedItems.size} seleccionados</span>
          <Button size="sm" variant="outline" onClick={handleArchive} disabled={isPending}>
            Archivar
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Limpiar
          </Button>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Selecciona clientes para acciones en lote</span>
      )}
    </div>
  );
}

function ClientRow({ client }: { client: ClientListRow }) {
  const { selectedItems, toggleItem } = useBulkActions();
  const checked = selectedItems.has(client.id);

  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={checked}
          onCheckedChange={() => toggleItem(client.id)}
          aria-label={`Seleccionar ${client.fullName}`}
        />
      </TableCell>
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
          {client.type === "COMPANY" ? "Empresa" : "Persona"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{client._count.policies}</TableCell>
      <TableCell className="text-right">{client._count.receipts}</TableCell>
      <TableCell className="text-right">{client._count.tasks}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(new Date(client.createdAt))}</TableCell>
      <TableCell>
        <StatusBadge status={client.status} />
      </TableCell>
    </TableRow>
  );
}
