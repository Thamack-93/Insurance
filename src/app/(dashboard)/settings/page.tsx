import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { BellRing, Database, Globe2, ArrowRight, Settings2, KeyRound, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const liveUser = await getCurrentUser();
  const isAdmin = !!liveUser && liveUser.active && liveUser.role === "ADMIN";
  const [settings, initialBackups, onboarding] = await Promise.all([
    getSettings(),
    isAdmin ? listBackupsAction() : Promise.resolve([]),
    getOnboardingStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
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

        {isAdmin ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" /> Mi cuenta
              </CardTitle>
              <CardDescription>Cambia tu contraseña y revisa tu rol.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/settings/account">
                  Ir a mi cuenta
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> Usuarios
                </CardTitle>
                <CardDescription>Invita y administra a tu equipo.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/settings/users">
                    Administrar usuarios
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>

        {isAdmin ? (
          <SettingsForm
            initialSettings={settings}
            updateSettings={updateSettings}
          />
        ) : null}

        <OnboardingPanel initialDismissed={onboarding.dismissed} />

        {isAdmin ? (
          <BackupsPanel
            initialBackups={initialBackups}
            createBackup={createBackup}
            restoreBackup={restoreBackup}
            listBackups={listBackupsAction}
          />
        ) : null}
      </div>
    </div>
  );
}
