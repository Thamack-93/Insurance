import Link from "next/link";
import { ArrowLeft, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUserOrRedirect } from "@/lib/auth";
import { getNotificationPreferencesForUser } from "@/lib/notification-foundation";
import { notificationEventCatalog } from "@/lib/notification-foundation-shared";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import {
  disconnectTelegram,
  generateTelegramLinkCode,
  saveNotificationPreferences,
  sendTelegramTestMessage,
} from "./actions";

export default async function NotificationSettingsPage() {
  const user = await requireUserOrRedirect();
  const snapshot = await getNotificationPreferencesForUser(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Notificaciones"
          description="Prepara Telegram y ajusta tus preferencias de alerta para las notificaciones futuras."
          actions={
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/settings">
                <ArrowLeft className="mr-2 size-4" />
                Volver a configuración
              </Link>
            </Button>
          }
        />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-4" />
                Canal
              </CardTitle>
              <CardDescription>Telegram ya puede vincularse desde esta pantalla.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge variant={snapshot.channel.isEnabled && snapshot.channel.telegramChatId ? "default" : "outline"} className="rounded-full">
                {snapshot.channel.isEnabled && snapshot.channel.telegramChatId ? "Conectado" : "Desconectado"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {snapshot.channel.isEnabled && snapshot.channel.telegramChatId
                  ? `Chat vinculado: ${snapshot.channel.telegramChatId}`
                  : "No hay un chat vinculado todavía. Genera un código y envíalo por /link en Telegram para conectarlo."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eventos listos</CardTitle>
              <CardDescription>Tipos de aviso que ya quedan preparados.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {notificationEventCatalog.map((item) => (
                  <Badge key={item.eventType} variant="secondary" className="rounded-full">
                    {item.title}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Estos eventos ya se guardan en la base y quedan listos para Telegram en la siguiente etapa.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acceso</CardTitle>
              <CardDescription>Solo se editan tus propias preferencias.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {user.role === "ADMIN" ? "Cuenta de administrador activa." : "Cuenta de agente activa."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado</CardTitle>
              <CardDescription>Se guardan preferencias y auditoría.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {snapshot.preferences.length} preferencias cargadas para tu usuario.
            </CardContent>
          </Card>
        </section>

        <NotificationPreferencesPanel
          key={[
            snapshot.channel.updatedAt.getTime(),
            snapshot.preferences.map((pref) => pref.updatedAt.getTime()).join("-"),
          ].join(":")}
          snapshot={snapshot}
          generateTelegramLinkCode={generateTelegramLinkCode}
          disconnectTelegram={disconnectTelegram}
          sendTelegramTestMessage={sendTelegramTestMessage}
          saveNotificationPreferences={saveNotificationPreferences}
        />
      </div>
    </div>
  );
}
