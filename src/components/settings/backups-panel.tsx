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
import { getBackupScheduleStatus, PLATFORM_BACKUP_INTERVAL_DAYS } from "@/lib/backup-schedule";
import { backupCapabilityLabel, backupStatusLabel, backupStorageLabel } from "@/lib/ui-labels";

type Props = {
  initialBackups: BackupListItem[];
  initialLoadError?: string | null;
  backupStatus: BackupPreflightStatus;
  createBackup: () => Promise<MutationResult>;
  listBackups: () => Promise<BackupListItem[]>;
  reconcileBackups: () => Promise<MutationResult>;
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

export function BackupsPanel({
  initialBackups,
  initialLoadError = null,
  backupStatus,
  createBackup,
  listBackups,
  reconcileBackups,
}: Props) {
  const [backups, setBackups] = useState<BackupListItem[]>(initialBackups);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [pendingCreate, startCreate] = useTransition();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [pendingReconcile, startReconcile] = useTransition();
  const [now] = useState(() => new Date());
  const sorted = [...backups].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const latestVerified = sorted.find((backup) => backup.status === "VERIFIED");
  const schedule = getBackupScheduleStatus(
    latestVerified ? new Date(latestVerified.createdAt) : null,
    now,
    PLATFORM_BACKUP_INTERVAL_DAYS,
  );

  async function refresh() {
    try {
      setBackups(await listBackups());
      setLoadError(null);
    } catch {
      setLoadError("No se pudo consultar el catálogo de respaldos.");
      toast.error("No se pudo actualizar la lista de respaldos.");
    }
  }

  function handleCreate() {
    startCreate(async () => {
      const result = await createBackup();
      if (result.ok) {
        setResultMessage(result.message);
        toast.success(result.message);
        await refresh();
      } else {
        setResultMessage(result.error);
        toast.error(result.error);
      }
    });
  }

  async function handleVerify(artifactId: string) {
    setVerifying(artifactId);
    try {
      const result = await verifyBackupAction(artifactId);
      if (result.ok) {
        setResultMessage(result.message);
        toast.success(result.message);
        await refresh();
      } else {
        setResultMessage(result.error);
        toast.error(result.error);
      }
    } finally {
      setVerifying(null);
    }
  }

  function handleReconcile() {
    startReconcile(async () => {
      const result = await reconcileBackups();
      if (result.ok) {
        setResultMessage(result.message);
        toast.success(result.message);
        await refresh();
      } else {
        setResultMessage(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <SectionCard
      title="Respaldos globales de plataforma"
      description="Snapshot completo global semanal, privado, comprimido y cifrado. Retención configurada: 30 días. La restauración se realiza fuera de la web."
      action={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 size-4" />
            Actualizar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleReconcile} disabled={pendingReconcile}>
            <ShieldCheck className="mr-2 size-4" />
            {pendingReconcile ? "Reconciliando..." : "Reconciliar almacenamiento"}
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
          <Badge variant="secondary" className="rounded-full">Global · semanal</Badge>
          <Badge variant="secondary" className="rounded-full">Retención · 30 días</Badge>
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
            <div key={check.key} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
              <p className="font-medium text-foreground">{check.label}</p>
              <p className="mt-1">{check.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Último respaldo verificado: {latestVerified ? formatDateTime(latestVerified.createdAt) : "ninguno"} · Próximo vencimiento: {formatDateTime(schedule.nextDueAt.toISOString())} · Estado semanal: {backupStatusLabel(schedule.status)}
        </p>
      </div>
      {resultMessage ? <p className="border-b border-border/60 px-6 py-3 text-sm text-foreground" role="status" aria-live="polite">{resultMessage}</p> : null}
      {loadError ? (
        <div className="border-b border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100" role="alert">
          <p className="font-medium">{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>Reintentar consulta</Button>
        </div>
      ) : null}
      {!loadError && sorted.length === 0 ? (
        <div className="p-6">
          <EmptyPanel
            icon={Database}
            title="Sin respaldos"
            description="Crea el primer respaldo cifrado de la base de datos."
          />
        </div>
      ) : !loadError ? (
        <ul className="divide-y divide-border/60">
          {sorted.map((backup) => (
            <li
              key={backup.id}
              className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{backup.filename}</p>
                  <Badge variant="outline" className="rounded-full">Global</Badge>
                  <Badge variant={backup.status === "VERIFIED" ? "secondary" : "outline"} className="rounded-full">{backupStatusLabel(backup.status)}</Badge>
                  <Badge variant={backup.capability === "DATABASE_ONLY" ? "destructive" : "outline"} className="rounded-full">{backupCapabilityLabel(backup.capability)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(backup.createdAt)} · {formatSize(backup.size)} · v{backup.formatVersion ?? "?"} · {backupStorageLabel(backup.storage)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!backup.manifestAvailable || backup.status === "PRUNED" || verifying === backup.id}
                  onClick={() => void handleVerify(backup.id)}
                >
                  <ShieldCheck className="mr-2 size-4" />
                  {verifying === backup.id ? "Verificando..." : "Verificar"}
                </Button>
                {backup.status === "VERIFIED" ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/backups/artifacts/${encodeURIComponent(backup.id)}/download`} download={backup.filename}>
                      <Download className="mr-2 size-4" /> Descargar cifrado
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    <Download className="mr-2 size-4" /> Descargar cifrado
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
