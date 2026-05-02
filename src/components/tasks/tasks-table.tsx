"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkActionsProvider } from "@/components/bulk-actions/bulk-actions-provider";
import { BulkActionsToolbar } from "@/components/bulk-actions/bulk-actions-toolbar";
import { SelectableRow } from "@/components/bulk-actions/selectable-row";
import { SelectAllHeader } from "@/components/bulk-actions/select-all-header";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { bulkUpdateTaskStatus } from "@/app/(dashboard)/tasks/actions";

const taskTypeLabels: Record<string, string> = {
  GENERAL: "General",
  CLAIM: "Siniestro",
  QUOTE: "Cotización",
  RENEWAL: "Renovación",
  PAYMENT: "Cobranza",
  DOCUMENT: "Documento",
  COMMISSION: "Comisión",
  OTHER: "Otro",
};

export type TaskRow = {
  id: string;
  folio: string;
  title: string;
  taskType: string;
  priority: string;
  status: string;
  dueDate: string | null;
  dueDays: number | null;
  clientId: string | null;
  clientName: string | null;
  policyId: string | null;
  policyNumber: string | null;
};

function TasksTableInner({ tasks }: { tasks: TaskRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const ids = tasks.map((t) => t.id);

  const handleBulkStatus = (status: string) => {
    startTransition(async () => {
      const result = await bulkUpdateTaskStatus(ids, status);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else if (!result.ok) {
        toast.error(result.error);
      }
    });
  };

  const statusOptions = [
    { value: "RESOLVED", label: "Marcar resuelto" },
    { value: "CANCELLED", label: "Cancelar" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <BulkActionsToolbar
        onStatusChange={handleBulkStatus}
        statusOptions={statusOptions}
      />
      <Table>
        <TableHeader>
          <TableRow className="bg-stone-50/70">
            <SelectAllHeader ids={ids} />
            <TableHead>Folio</TableHead>
            <TableHead>Título</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Póliza</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Vence</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <SelectableRow key={task.id} id={task.id}>
              <TableCell className="font-medium">
                <Link href={`/tasks/${task.id}`} className="hover:text-primary">
                  {task.folio}
                </Link>
              </TableCell>
              <TableCell className="max-w-[260px] truncate">{task.title}</TableCell>
              <TableCell>
                {task.clientId ? (
                  <Link href={`/clients/${task.clientId}`} className="text-foreground hover:text-primary">
                    {task.clientName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Sin cliente</span>
                )}
              </TableCell>
              <TableCell>
                {task.policyId ? (
                  <Link href={`/policies/${task.policyId}`} className="text-foreground hover:text-primary">
                    {task.policyNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Sin póliza</span>
                )}
              </TableCell>
              <TableCell>{taskTypeLabels[task.taskType] ?? task.taskType}</TableCell>
              <TableCell>
                {task.dueDate ? (
                  <span className="text-sm text-muted-foreground">
                    {task.dueDate} · {task.dueDays} días
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Sin fecha</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                </div>
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

export function TasksTable({ tasks }: { tasks: TaskRow[] }) {
  return (
    <BulkActionsProvider>
      <TasksTableInner tasks={tasks} />
    </BulkActionsProvider>
  );
}
