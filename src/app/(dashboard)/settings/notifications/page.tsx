import Link from "next/link";
import { ArrowLeft, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUserOrRedirect } from "@/lib/auth";
import { getTelegramChannelStateForUser } from "@/lib/telegram";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import {
  disconnectTelegram,
  generateTelegramLinkCode,
  sendTelegramDigestNow,
  sendTelegramTestMessage,
  updateTelegramDigestHour,
  updateNotificationTimezone,
} from "./actions";

export default async function NotificationSettingsPage() {
  const user = await requireUserOrRedirect();
  const channel = await getTelegramChannelStateForUser(user.id);
  const timeZone = user.timeZone ?? "America/Mexico_City";
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Notificaciones"
          description="Prepara Telegram, define la hora del resumen diario y revisa el estado del cron."
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
              <Badge variant={channel?.isEnabled && channel.telegramChatId ? "default" : "outline"} className="rounded-full">
                {channel?.isEnabled && channel.telegramChatId ? "Conectado" : "Desconectado"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {channel?.isEnabled && channel.telegramChatId
                  ? `Chat vinculado: ${channel.telegramChatId}`
                  : "No hay un chat vinculado todavía. Genera un código y envíalo por /link en Telegram para conectarlo."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acceso</CardTitle>
              <CardDescription>Solo se edita tu canal y la hora del resumen diario.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {user.role === "ADMIN" ? "Cuenta de administrador activa." : "Cuenta de agente activa."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado</CardTitle>
              <CardDescription>Se guarda auditoría del canal y del resumen diario.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {channel?.isEnabled && channel.telegramChatId
                ? "Telegram está conectado y listo para enviar el resumen diario."
                : "Telegram todavía no está conectado para este usuario."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zona horaria</CardTitle>
              <CardDescription>Define cómo interpretamos la hora elegida para el resumen diario.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {timeZone}. El resumen diario se enviará en esa zona horaria a la hora seleccionada.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen diario</CardTitle>
              <CardDescription>La hora fija en la que se revisa el cron para tu resumen de Telegram.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                <Badge variant={cronSecretConfigured ? "default" : "outline"} className="rounded-full">
                  {cronSecretConfigured ? "Cron activo" : "Cron pendiente"}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  {String(user.telegramDigestHour).padStart(2, "0")}:00
                </Badge>
              </div>
              <p>
                El cron revisa la cola cada hora y envía tu resumen cuando coincide con{" "}
                <span className="font-medium text-foreground">
                  {String(user.telegramDigestHour).padStart(2, "0")}:00
                </span>{" "}
                en tu zona horaria.
              </p>
            </CardContent>
          </Card>
        </section>

        <NotificationPreferencesPanel
          key={[channel?.updatedAt.getTime() ?? 0, timeZone, user.telegramDigestHour].join(":")}
          channel={
            channel ?? {
              id: "",
              userId: user.id,
              type: "TELEGRAM",
              telegramChatId: null,
              isEnabled: false,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            }
          }
          timeZone={timeZone}
          digestHour={user.telegramDigestHour}
          generateTelegramLinkCode={generateTelegramLinkCode}
          disconnectTelegram={disconnectTelegram}
          sendTelegramDigestNow={sendTelegramDigestNow}
          sendTelegramTestMessage={sendTelegramTestMessage}
          updateTelegramDigestHour={updateTelegramDigestHour}
          updateNotificationTimezone={updateNotificationTimezone}
        />
      </div>
    </div>
  );
}
