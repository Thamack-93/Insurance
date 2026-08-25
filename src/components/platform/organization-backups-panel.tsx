"use client";

import { useState, useTransition } from "react";
import { Database, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  verifyOrganizationBackupAction,
  type OrganizationBackupListItem,
} from "@/app/(dashboard)/settings/backups-actions";
import { EmptyPanel, SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BackupPreflightStatus } from "@/lib/backup";
import type { MutationResult } from "@/lib/mutation-utils";
import { getBackupScheduleStatus, TENANT_BACKUP_INTERVAL_DAYS } from "@/lib/backup-schedule";

type Props = {
  organizationId: string;
  initialBackups: OrganizationBackupListItem[];
  backupStatus: BackupPreflightStatus;
  createBackup: (organizationId: string) => Promise<MutationResult>;
  listBackups: (organizationId: string) => Promise<OrganizationBackupListItem[]>;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrganizationBackupsPanel({ organizationId, initialBackups, backupStatus, createBackup, listBackups }: Props) {
  const [backups, setBackups] = useState(initialBackups);
  const [now] = useState(() => Date.now());
  const [pendingCreate, startCreate] = useTransition();
  const [verifying, setVerifying] = useState<string | null>(null);
  const latestVerified = backups.find((backup) => backup.status === "VERIFIED");
  const schedule = getBackupScheduleStatus(latestVerified ? new Date(latestVerified.createdAt) : null, new Date(now), TENANT_BACKUP_INTERVAL_DAYS);
  const rpoMissed = schedule.status !== "HEALTHY";

  async function refresh() {
    try {
      setBackups(await listBackups(organizationId));
    } catch {
      toast.error("No se pudo actualizar la lista de respaldos.");
    }
  }

  function handleCreate() {
    startCreate(async () => {
      const result = await createBackup(organizationId);
      if (result.ok) {
        toast.success(result.message);
        await refresh();
      } else toast.error(result.error);
    });
  }

  async function handleVerify(id: string) {
    setVerifying(id);
    try {
      const result = await verifyOrganizationBackupAction(id);
      if (result.ok) {
        toast.success(result.message);
        await refresh();
      } else toast.error(result.error);
    } finally {
      setVerifying(null);
    }
  }

  return (
    <SectionCard
      title="Respaldos de esta organización"
      description="Snapshots diarios de esta organización. Los respaldos globales de plataforma se administran por separado en el panel SUPERADMIN."
      action={(
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 size-4" /> Actualizar
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={pendingCreate || !backupStatus.ready}>
            <Database className="mr-2 size-4" /> {pendingCreate ? "Creando..." : "Crear respaldo"}
          </Button>
        </div>
      )}
    >
      {!backupStatus.ready ? (
        <p className="border-b border-border/60 px-6 py-3 text-sm text-amber-700 dark:text-amber-300">
          La configuración de backup no está lista; no se puede crear un snapshot.
        </p>
      ) : null}
      {backups.length === 0 ? (
        <div className="p-6"><EmptyPanel icon={Database} title="Sin respaldos" description="Crea el primer snapshot de esta organización." /></div>
      ) : (
        <ul className="divide-y divide-border/60">
          {backups.map((backup) => (
            <li key={backup.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{backup.filename}</p>
                  <Badge variant="default" className="rounded-full">Tenant</Badge>
                  {backup.capability === "DATABASE_ONLY" ? <Badge variant="destructive" className="rounded-full">Solo base de datos</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(backup.createdAt)} · {formatSize(backup.size)} · {backup.status} · v{backup.formatVersion ?? "?"} · {backup.storage}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!backup.manifestAvailable || verifying === backup.id} onClick={() => void handleVerify(backup.id)}>
                  <ShieldCheck className="mr-2 size-4" /> {verifying === backup.id ? "Verificando..." : "Verificar"}
                </Button>
                {backup.status === "VERIFIED" ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/backups/artifacts/${encodeURIComponent(backup.id)}/download`} download={backup.filename}>
                      <Download className="mr-2 size-4" /> Descargar
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    <Download className="mr-2 size-4" /> Descargar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={`border-t px-6 py-3 text-sm ${rpoMissed ? "bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200" : "text-muted-foreground"}`}>
        Último backup verificado: {latestVerified ? formatDateTime(latestVerified.createdAt) : "ninguno"} · Próximo vencimiento: {formatDateTime(schedule.nextDueAt.toISOString())} · RPO 1 día
        {rpoMissed ? " · RPO incumplido" : ""}
      </div>
    </SectionCard>
  );
}
