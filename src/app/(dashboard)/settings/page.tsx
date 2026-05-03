import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { BellRing, Database, Globe2, ShieldCheck, ArrowRight, Settings2 } from "lucide-react";
import { today, formatDate } from "@/lib/dates";
import Link from "next/link";
import { getSettings, updateSettings } from "@/lib/settings";
import { getOnboardingStatus } from "@/lib/dashboard-queries";
import { SettingsForm } from "@/components/forms/settings-form";
import { BackupsPanel } from "@/components/settings/backups-panel";
import { OnboardingPanel } from "@/components/settings/onboarding-panel";
import {
  createBackup,
  listBackupsAction,
  restoreBackup,
} from "./backups-actions";

export default async function SettingsPage() {
  const now = today();
  const [settings, initialBackups, onboarding] = await Promise.all([
    getSettings(),
    listBackupsAction(),
    getOnboardingStatus(),
  ]);

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Configuración"
          description="Personaliza los datos de tu firma y las preferencias del sistema."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/reports">
                Ir a reportes
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard 
            title="Firma" 
            value={settings.firmName} 
            description="Nombre configurado" 
            icon={Settings2} 
            tone="blue" 
          />
          <MetricCard 
            title="Moneda" 
            value={settings.defaultCurrency} 
            description="Divisa por defecto" 
            icon={Globe2} 
            tone="amber" 
          />
          <MetricCard 
            title="Respaldo" 
            value={settings.autoBackup ? "Auto" : "Manual"} 
            description={settings.autoBackup ? `${settings.backupFrequency}` : "Sin respaldo automático"} 
            icon={Database} 
            tone="emerald" 
          />
          <MetricCard 
            title="Actualizado" 
            value={formatDate(now)} 
            description="Última actualización" 
            icon={BellRing} 
            tone="rose" 
          />
        </section>

        <SettingsForm 
          initialSettings={settings} 
          updateSettings={updateSettings} 
        />

        <OnboardingPanel initialDismissed={onboarding.dismissed} />

        <BackupsPanel
          initialBackups={initialBackups}
          createBackup={createBackup}
          restoreBackup={restoreBackup}
          listBackups={listBackupsAction}
        />
      </div>
    </main>
  );
}
