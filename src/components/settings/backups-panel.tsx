"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Download, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard, EmptyPanel } from "@/components/pages-secondary/panels";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { MutationResult } from "@/lib/mutation-utils";
import type { BackupListItem } from "@/app/(dashboard)/settings/backups-actions";

type Props = {
  initialBackups: BackupListItem[];
  createBackup: () => Promise<MutationResult>;
  restoreBackup: (filename: string) => Promise<MutationResult>;
  listBackups: () => Promise<BackupListItem[]>;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function BackupsPanel({ initialBackups, createBackup, restoreBackup, listBackups }: Props) {
  const router = useRouter();
  const [backups, setBackups] = useState<BackupListItem[]>(initialBackups);
  const [pendingCreate, startCreate] = useTransition();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [backups],
  );

  async function refresh() {
    const next = await listBackups();
    setBackups(next);
  }

  function handleCreate() {
    startCreate(async () => {
      const result = await createBackup();
      if (result.ok) {
        toast.success(result.message);
        await refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  async function handleRestore(filename: string) {
    setRestoring(filename);
    try {
      const result = await restoreBackup(filename);
      if (result.ok) {
        toast.success(result.message);
        await refresh();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setRestoring(null);
      setConfirmTarget(null);
    }
  }

  return (
    <SectionCard
      title="Respaldos"
      description="Crea, descarga y restaura copias locales de la base de datos. Se conservan los 10 más recientes."
      action={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            Actualizar
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={pendingCreate}>
            <Database className="mr-2 size-4" />
            {pendingCreate ? "Creando…" : "Crear respaldo ahora"}
          </Button>
        </div>
      }
    >
      {sorted.length === 0 ? (
        <div className="p-6">
          <EmptyPanel
            icon={Database}
            title="Sin respaldos"
            description="Crea tu primer respaldo para tener una copia local de la base de datos."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {sorted.map((backup) => {
            const isRestoring = restoring === backup.filename;
            return (
              <li
                key={backup.filename}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{backup.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(backup.createdAt)} · {formatSize(backup.size)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/backups/${encodeURIComponent(backup.filename)}/download`}
                      download={backup.filename}
                    >
                      <Download className="mr-2 size-4" />
                      Descargar
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmTarget(backup.filename)}
                    disabled={isRestoring}
                  >
                    <RotateCcw className="mr-2 size-4" />
                    {isRestoring ? "Restaurando…" : "Restaurar"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar este respaldo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto reemplazará todos los datos actuales con el contenido de{" "}
              <span className="font-medium text-foreground">{confirmTarget}</span>. Antes de
              sobrescribir, se guardará un respaldo automático del estado actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring !== null}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={restoring !== null}
              onClick={() => {
                if (confirmTarget) void handleRestore(confirmTarget);
              }}
            >
              {restoring ? "Restaurando…" : "Restaurar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
