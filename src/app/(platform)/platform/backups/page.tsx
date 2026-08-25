import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getBackupPreflightStatus } from "@/lib/backup";
import { BackupsPanel } from "@/components/settings/backups-panel";
import { PageHeader } from "@/components/layout/page-header";
import { createBackup, listBackupsAction, reconcileBackupCatalogAction, type BackupListItem } from "@/app/(dashboard)/settings/backups-actions";

export const dynamic = "force-dynamic";

export default async function PlatformBackupsPage() {
  await requireSuperAdminOrRedirect();
  let backups: BackupListItem[] = [];
  let initialLoadError: string | null = null;
  try {
    backups = await listBackupsAction();
  } catch {
    initialLoadError = "No se pudo consultar el catálogo de respaldos.";
  }
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6"><PageHeader eyebrow="Control de plataforma" title="Respaldos" description="Snapshots globales, privados y cifrados. La restauración continúa siendo CLI-only y requiere un destino temporal autorizado." /><BackupsPanel initialBackups={backups} initialLoadError={initialLoadError} backupStatus={getBackupPreflightStatus()} createBackup={createBackup} listBackups={listBackupsAction} reconcileBackups={reconcileBackupCatalogAction} /></div>;
}
