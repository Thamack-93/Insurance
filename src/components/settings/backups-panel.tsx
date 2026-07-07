"use client";

import { useState, useTransition } from "react";
import { Database, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  verifyBackupAction,
  type BackupListItem,
} from "@/app/(dashboard)/settings/backups-actions";
import { EmptyPanel, SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BackupPreflightStatus } from "@/lib/backup";
import type { MutationResult } from "@/lib/mutation-utils";

type Props = {
  initialBackups: BackupListItem[];
  backupStatus: BackupPreflightStatus;
  createBackup: () => Promise<MutationResult>;
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

export function BackupsPanel({ initialBackups, backupStatus, createBackup, listBackups }: Props) {
  const [backups, setBackups] = useState<BackupListItem[]>(initialBackups);
  const [pendingCreate, startCreate] = useTransition();
  const [verifying, setVerifying] = useState<string | null>(null);
  const sorted = [...backups].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  async function refresh() {
    try {
      setBackups(await listBackups());
    } catch {
      toast.error("No se pudo actualizar la lista de respaldos.");
    }
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

  async function handleVerify(filename: string) {
    setVerifying(filename);
    try {
      const result = await verifyBackupAction(filename);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    } finally {
      setVerifying(null);
    }
  }

  return (
    <SectionCard
      title="Respaldos cifrados"
      description="Snapshots Postgres privados, comprimidos y cifrados. Retención: 7 diarios, 2 semanales y 1 mensual. La restauración se realiza fuera de la web."
      action={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 size-4" />
            Actualizar
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={pendingCreate}>
            <Database className="mr-2 size-4" />
            {pendingCreate ? "Creando..." : "Crear respaldo ahora"}
          </Button>
        </div>
      }
    >
      <div className="border-b border-border/60 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={backupStatus.ready ? "default" : "outline"} className="rounded-full">
            {backupStatus.ready ? "Backup listo" : "Backup incompleto"}
          </Badge>
          {backupStatus.checks.map((check) => (
            <Badge
              key={check.key}
              variant={check.ok ? "secondary" : "destructive"}
              className="rounded-full"
            >
              {check.label}
            </Badge>
          ))}
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
          {backupStatus.checks.map((check) => (
            <div key={check.key} className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
              <p className="font-medium text-foreground">{check.label}</p>
              <p className="mt-1">{check.detail}</p>
            </div>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="p-6">
          <EmptyPanel
            icon={Database}
            title="Sin respaldos"
            description="Crea el primer snapshot cifrado de la base Postgres."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {sorted.map((backup) => (
            <li
              key={backup.filename}
              className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{backup.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(backup.createdAt)} · {formatSize(backup.size)} ·{" "}
                  {backup.manifestAvailable ? "manifiesto disponible" : "sin manifiesto"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!backup.manifestAvailable || verifying === backup.filename}
                  onClick={() => void handleVerify(backup.filename)}
                >
                  <ShieldCheck className="mr-2 size-4" />
                  {verifying === backup.filename ? "Verificando..." : "Verificar"}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/backups/${encodeURIComponent(backup.filename)}/download`}
                    download={backup.filename}
                  >
                    <Download className="mr-2 size-4" />
                    Descargar cifrado
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
