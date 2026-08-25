import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BellRing, Bot, Database, ArrowRight, KeyRound, Users } from "@/components/icons";
import { Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { getOnboardingStatus } from "@/lib/dashboard-queries";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { requireOrganizationContext } from "@/lib/organization-context";
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
  const organization = await requireOrganizationContext();
  const isTenantAdmin = organization.membershipRole === "OWNER" || organization.membershipRole === "ADMIN";
  const aiStatus = getAssistantAiConnectionStatus();
  const [onboarding, ownerBackupStatus] = await Promise.all([
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

        <OnboardingPanel initialDismissed={onboarding.dismissed} />

        {ownerBackupStatus ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4" /> Respaldo de mi organización
              </CardTitle>
              <CardDescription>
                Último respaldo verificado de tu organización. Los snapshots globales de plataforma se administran únicamente desde SUPERADMIN.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {ownerBackupStatus.status === "HEALTHY" && ownerBackupStatus.latestCreatedAt
                ? `Último respaldo diario verificado: ${formatDateTime(ownerBackupStatus.latestCreatedAt)}. Próximo vencimiento: ${ownerBackupStatus.nextDueAt ? formatDateTime(ownerBackupStatus.nextDueAt) : "pendiente"}.`
                : ownerBackupStatus.status === "OVERDUE" && ownerBackupStatus.latestCreatedAt
                  ? `El último respaldo verificado fue ${formatDateTime(ownerBackupStatus.latestCreatedAt)} y el RPO diario está vencido.`
                : ownerBackupStatus.status === "NOT_CONFIGURED"
                  ? "Todavía no hay un respaldo diario de esta organización."
                  : "El estado del respaldo no está disponible temporalmente."}
            </CardContent>
          </Card>
        ) : null}

      </div>
    </div>
  );
}
