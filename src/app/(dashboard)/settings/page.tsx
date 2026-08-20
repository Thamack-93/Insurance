import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { BellRing, Bot, Database, Globe2, ArrowRight, Settings2, KeyRound, Users } from "@/components/icons";
import { Wrench } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { today, formatDate } from "@/lib/dates";
import Link from "next/link";
import { getSettings, updateSettings } from "@/lib/settings";
import { getOnboardingStatus } from "@/lib/dashboard-queries";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { requireOrganizationContext } from "@/lib/organization-context";
import { SettingsForm } from "@/components/forms/settings-form";
import { OnboardingPanel } from "@/components/settings/onboarding-panel";
import { getOrganizationBackupStatus } from "@/lib/organization-backup-status";

export const maxDuration = 300;

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function SettingsPage() {
  const now = today();
  const liveUser = await getCurrentUser();
  const organization = await requireOrganizationContext();
  const isTenantAdmin = organization.membershipRole === "OWNER" || organization.membershipRole === "ADMIN";
  const isPlatformAdmin = !!liveUser && liveUser.active && liveUser.platformRole === "SUPERADMIN";
  const aiStatus = getAssistantAiConnectionStatus();
  const [settings, onboarding, ownerBackupStatus] = await Promise.all([
    getSettings(),
    getOnboardingStatus(),
    organization.membershipRole === "OWNER" ? getOrganizationBackupStatus() : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Configuración"
          description="Personaliza los datos de tu firma y las preferencias del sistema."
          actions={
            <Button asChild>
              <Link href="/reports">
                Ir a reportes
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        {isPlatformAdmin ? (
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

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" /> Mi cuenta
              </CardTitle>
              <CardDescription>Cambia tu contraseña y revisa tu rol.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/settings/account">
                  Ir a mi cuenta
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-4" /> Notificaciones
              </CardTitle>
              <CardDescription>Configura Telegram y tus preferencias de aviso.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/settings/notifications">
                  Abrir notificaciones
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          {isTenantAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> Usuarios
                </CardTitle>
                <CardDescription>Invita y administra a tu equipo.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href="/settings/users">
                    Administrar usuarios
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {isTenantAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="size-4" /> Nora y reportes IA
                </CardTitle>
                <CardDescription>
                  Revisa incidentes, sugerencias, evidencia y configuración de uso.
                  {aiStatus.available
                    ? ` IA conectada con ${aiStatus.model}.`
                    : " IA desconectada por ahora."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href="/settings/assistant">
                    Abrir panel IA
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {isTenantAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="size-4" /> Centro Operativo
                </CardTitle>
                <CardDescription>Accede a catálogos, riesgos, documentos, auditoría y controles internos.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/settings/centro-operativo">
                    Abrir centro operativo
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>

        {isPlatformAdmin ? (
          <SettingsForm
            initialSettings={settings}
            updateSettings={updateSettings}
          />
        ) : null}

        <OnboardingPanel initialDismissed={onboarding.dismissed} />

        {ownerBackupStatus ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4" /> Respaldo de mi organización
              </CardTitle>
              <CardDescription>
                Estado del servicio de respaldo global. Los archivos físicos contienen datos de toda la plataforma y no se descargan desde una cuenta tenant.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {ownerBackupStatus.status === "AVAILABLE" && ownerBackupStatus.latestCreatedAt
                ? `Último respaldo disponible: ${formatDateTime(ownerBackupStatus.latestCreatedAt)}`
                : ownerBackupStatus.status === "NOT_CONFIGURED"
                  ? "Todavía no hay un respaldo global disponible."
                  : "El estado del respaldo no está disponible temporalmente."}
            </CardContent>
          </Card>
        ) : null}

      </div>
    </div>
  );
}
