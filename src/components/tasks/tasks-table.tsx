"use client";

import { useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { ArrowUpCircle, Flag, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BulkActionsProvider, useBulkActions } from "@/components/bulk-actions/bulk-actions-provider";
import { SelectableRow } from "@/components/bulk-actions/selectable-row";
import { SelectAllHeader } from "@/components/bulk-actions/select-all-header";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { DeleteWorkItemButton } from "@/components/tasks/delete-task-button";
import {
  bulkDeleteWorkItems,
  bulkUpdateWorkItemPriority,
  bulkUpdateWorkItemStatus,
} from "@/app/(dashboard)/tasks/actions";
import { workItemTypeLabel } from "@/lib/ui-labels";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "IN_PROGRESS", label: "En proceso" },
  { value: "WAITING_CLIENT", label: "Esperando cliente" },
  { value: "WAITING_INSURER", label: "Esperando aseguradora" },
  { value: "RESOLVED", label: "Marcar resuelto" },
  { value: "CANCELLED", label: "Cancelar" },
];

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "URGENT", label: "Urgente" },
  { value: "HIGH", label: "Alta" },
  { value: "MEDIUM", label: "Media" },
  { value: "LOW", label: "Baja" },
];

export type WorkItemRow = {
  id: string;
  folio: string;
  title: string;
  workItemType: string;
  priority: string;
  status: string;
  dueDate: string | null;
  dueDays: number | null;
  clientId: string | null;
  clientName: string | null;
  policyId: string | null;
  policyNumber: string | null;
};

function WorkItemsTableInner({ workItems }: { workItems: WorkItemRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { selectedItems, hasSelection, clearSelection, getSelectedIds } = useBulkActions();
  const allIds = workItems.map((t) => t.id);
  const selectedCount = selectedItems.size;

  const runBulk = (
    fn: (ids: string[]) => Promise<{ ok: boolean; message?: string; error?: string }>,
    successFallback: string
  ) => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      toast.error("Selecciona al menos un pendiente.");
      return;
    }
    startTransition(async () => {
      const result = await fn(ids);
      if (result.ok) {
        toast.success(result.message ?? successFallback);
        flushSync(() => {
          clearSelection();
        });
        router.refresh();
      } else {
        toast.error(result.error ?? "No se pudo aplicar la acción.");
      }
    });
  };

  const handleStatus = (status: string) =>
    runBulk((ids) => bulkUpdateWorkItemStatus(ids, status), "Estado actualizado.");

  const handlePriority = (priority: string) =>
    runBulk((ids) => bulkUpdateWorkItemPriority(ids, priority), "Prioridad actualizada.");

  const handleDelete = async () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      toast.error("Selecciona al menos un pendiente.");
      return;
    }
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await bulkDeleteWorkItems(ids);
        if (result.ok) {
          toast.success(result.message ?? "Pendientes eliminados.");
          flushSync(() => {
            clearSelection();
          });
          router.refresh();
        } else {
          toast.error(result.error ?? "No se pudo eliminar.");
        }
        resolve();
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {hasSelection ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="rounded-full">
              {selectedCount} seleccionado{selectedCount !== 1 ? "s" : ""}
            </Badge>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={isPending}>
              Limpiar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending} className="h-8 gap-1" />
                }
              >
                <ArrowUpCircle className="size-3.5" />
                Estado
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Cambiar estado</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {STATUS_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => handleStatus(option.value)}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending} className="h-8 gap-1" />
                }
              >
                <Flag className="size-3.5" />
                Prioridad
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Cambiar prioridad</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PRIORITY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => handlePriority(option.value)}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              className="h-8 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Eliminar
            </Button>
            <ConfirmDialog
              open={confirmDeleteOpen}
              onOpenChange={setConfirmDeleteOpen}
              title={`Eliminar ${selectedCount} pendiente${selectedCount !== 1 ? "s" : ""}`}
              description="Esta acción es permanente y no se puede deshacer. ¿Quieres continuar?"
              confirmLabel="Eliminar"
              destructive
              onConfirm={handleDelete}
            />
          </div>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <SelectAllHeader ids={allIds} />
            <TableHead>Folio</TableHead>
            <TableHead>Título</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Póliza</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Vence</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Acción</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workItems.map((workItem) => (
            <SelectableRow key={workItem.id} id={workItem.id}>
              <TableCell className="font-medium">
                <Link href={`/tasks/${workItem.id}`} className="hover:text-primary">
                  {workItem.folio}
                </Link>
              </TableCell>
              <TableCell className="max-w-[260px] truncate">{workItem.title}</TableCell>
              <TableCell>
                {workItem.clientId ? (
                  <Link href={`/clients/${workItem.clientId}`} className="text-foreground hover:text-primary">
                    {workItem.clientName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Sin cliente</span>
                )}
              </TableCell>
              <TableCell>
                {workItem.policyId ? (
                  <Link href={`/policies/${workItem.policyId}`} className="text-foreground hover:text-primary">
                    {workItem.policyNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Sin póliza</span>
                )}
              </TableCell>
              <TableCell>{workItemTypeLabel(workItem.workItemType)}</TableCell>
              <TableCell>
                {workItem.dueDate ? (
                  <span className="text-sm text-muted-foreground">
                    {workItem.dueDate} · {workItem.dueDays} días
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Sin fecha</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <PriorityBadge priority={workItem.priority} />
                  <StatusBadge status={workItem.status} entity="workItem" />
                </div>
              </TableCell>
              <TableCell className="text-right">
                <DeleteWorkItemButton
                  id={workItem.id}
                  folio={workItem.folio}
                  triggerLabel="Eliminar"
                  triggerClassName="h-7 bg-card/70 px-2.5 text-xs text-destructive hover:text-destructive"
                />
              </TableCell>
            </SelectableRow>
          ))}
        </TableBody>
      </Table>
      {isPending && (
        <p className="text-center text-sm text-muted-foreground">Actualizando...</p>
      )}
    </div>
  );
}

export function WorkItemsTable({ workItems }: { workItems: WorkItemRow[] }) {
  return (
    <BulkActionsProvider>
      <WorkItemsTableInner workItems={workItems} />
    </BulkActionsProvider>
  );
}
