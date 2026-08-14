import Link from "next/link";
import { ArrowLeft, Database, ShieldCheck } from "lucide-react";
import { BackupsPanel } from "@/components/settings/backups-panel";
import { PageHeader } from "@/components/layout/page-header";
import { getBackupPreflightStatus } from "@/lib/backup";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { createBackup, listBackupsAction } from "@/app/(dashboard)/settings/backups-actions";

export const dynamic = "force-dynamic";

export default async function PlatformBackupsPage() {
  await requireSuperAdminOrRedirect();
  const [initialBackups, backupStatus] = await Promise.all([
    listBackupsAction().catch(() => []),
    Promise.resolve(getBackupPreflightStatus()),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        eyebrow="Plataforma"
        title="Respaldos globales"
        description="Los snapshots físicos contienen toda la base y solo están disponibles para SUPERADMIN. La restauración continúa siendo un proceso CLI fuera de la web."
        actions={
          <Link href="/platform" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline">
            <ArrowLeft className="size-4" aria-hidden />
            Volver al panel master
          </Link>
        }
      />
      <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Los Owners tenant no pueden descargar estos archivos globales. Su vista se limita al estado del servicio.
      </div>
      <BackupsPanel
        initialBackups={initialBackups}
        backupStatus={backupStatus}
        createBackup={createBackup}
        listBackups={listBackupsAction}
      />
      {initialBackups.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="size-4" aria-hidden />
          No hay snapshots globales listados todavía.
        </p>
      ) : null}
    </div>
  );
}
