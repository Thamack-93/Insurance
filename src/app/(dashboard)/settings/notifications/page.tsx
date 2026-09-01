import Link from "next/link";
import { ArrowLeft, BellRing } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { getTelegramChannelStateForUser } from "@/lib/telegram";
import { getNotificationPreferencesForUser } from "@/lib/notification-foundation";
import { DEFAULT_USER_TIME_ZONE } from "@/lib/time-zones";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import {
  disconnectTelegram,
  generateTelegramLinkCode,
  sendTelegramDigestNow,
  sendTelegramBirthdaysNow,
  sendTelegramTestMessage,
  setTelegramMutationsEnabled,
  updateTelegramPreferences,
} from "./actions";

export default async function NotificationSettingsPage() {
  const [user, context] = await Promise.all([requireUserOrRedirect(), requireOrganizationContext()]);
  const snapshot = await getNotificationPreferencesForUser(context.organizationId, user.id);
  const channel = snapshot.channel ?? (await getTelegramChannelStateForUser(context.organizationId, user.id));
  const timeZone = user.timeZone || DEFAULT_USER_TIME_ZONE;
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const telegramConnected = channel.isEnabled && Boolean(channel.telegramChatId);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Notificaciones"
          description="Configura Telegram como tu consola operativa y revisa el estado de sus avisos."
          actions={
            <Button asChild variant="outline">
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
              <Badge variant={telegramConnected ? "default" : "outline"} className="rounded-full">
                {telegramConnected ? "Conectado" : "Desconectado"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {telegramConnected
                  ? `Chat vinculado: ${channel.telegramChatId}`
                  : "No hay un chat vinculado todavía. Genera un código y envíalo por /link en Telegram para conectarlo."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Asistente Telegram</CardTitle>
              <CardDescription>La configuración se completa en tres pasos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Cuenta: {context.membershipRole === "AGENT" ? "agente" : "administrador"}.</p>
              <p>1. Genera un código y usa /link en un chat privado.</p>
              <p>2. Envía un mensaje de prueba.</p>
              <p>3. Activa cambios reales sólo cuando quieras mutar datos.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado</CardTitle>
              <CardDescription>Se guarda auditoría del canal y del resumen diario.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {telegramConnected
                ? "Telegram está conectado y listo para enviar el resumen diario."
                : "Telegram todavía no está conectado para este usuario."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zona horaria</CardTitle>
              <CardDescription>Zona fija usada para interpretar el resumen diario.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {timeZone}. Si necesitamos moverla, lo ajustamos manualmente.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen diario</CardTitle>
              <CardDescription>Horarios fijos del resumen y de los cumpleaños en Telegram.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                <Badge variant={cronSecretConfigured ? "default" : "outline"} className="rounded-full">
                  {cronSecretConfigured ? "Cron activo" : "Cron pendiente"}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  08:00 brief · 09:00 cumpleaños
                </Badge>
              </div>
              <p>
                El brief se envía a las 08:00 y los cumpleaños a las 09:00, hora de Ciudad de
                México. Los envíos manuales no reemplazan ni consumen los automáticos.
              </p>
            </CardContent>
          </Card>
        </section>

        <NotificationPreferencesPanel
          key={channel?.updatedAt.getTime() ?? 0}
          channel={
            channel ?? {
              id: "",
              userId: user.id,
              type: "TELEGRAM",
              telegramChatId: null,
              isEnabled: false,
              telegramMutationsEnabled: false,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            }
          }
          timeZone={timeZone}
          generateTelegramLinkCode={generateTelegramLinkCode}
          disconnectTelegram={disconnectTelegram}
          sendTelegramDigestNow={sendTelegramDigestNow}
          sendTelegramBirthdaysNow={sendTelegramBirthdaysNow}
          sendTelegramTestMessage={sendTelegramTestMessage}
          setTelegramMutationsEnabled={setTelegramMutationsEnabled}
          preferences={snapshot.preferences}
          updateTelegramPreferences={updateTelegramPreferences}
        />
      </div>
    </div>
  );
}
