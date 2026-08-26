import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { syncPlatformTelegramWebhookAction } from "../telegram-actions";
import { PlatformWebhookAction } from "@/components/platform/platform-webhook-action";

export const dynamic = "force-dynamic";

export default async function PlatformIntegrationsPage() {
  await requireSuperAdminOrRedirect();
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6"><header><p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Control de plataforma</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Integraciones</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Servicios globales que no pertenecen a una organización.</p></header><section className="rounded-2xl border bg-card p-5" aria-labelledby="platform-telegram-webhook"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="platform-telegram-webhook" className="font-semibold">Webhook global de Telegram</h2><p className="mt-1 text-sm text-muted-foreground">Sincroniza el bot exclusivamente con la URL canónica configurada en APP_BASE_URL.</p></div><PlatformWebhookAction action={syncPlatformTelegramWebhookAction} /></div></section><section className="rounded-2xl border border-dashed bg-muted/20 p-5"><h2 className="font-semibold">Más integraciones</h2><p className="mt-1 text-sm text-muted-foreground">Este espacio queda preparado para servicios globales adicionales sin mezclar configuraciones de organizaciones.</p></section></div>;
}
