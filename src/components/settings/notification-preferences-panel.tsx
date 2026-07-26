"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BellRing,
  CheckCircle2,
  Copy,
  Globe2,
  Link2,
  MessageSquareOff,
  Send,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { NotificationChannelRecord } from "@/lib/notification-foundation-shared";
import { notificationEventCatalog } from "@/lib/notification-foundation-shared";
import type { NotificationPreferenceInput, NotificationPreferenceRecord } from "@/lib/notification-foundation-shared";
import type { MutationResult } from "@/lib/mutation-utils";

type TelegramLinkCodeResult =
  | {
      ok: true;
      code: string;
      expiresAt: string;
      message: string;
      redirectTo: string;
    }
  | {
      ok: false;
      error: string;
    };

type Props = {
  channel: NotificationChannelRecord;
  timeZone: string;
  generateTelegramLinkCode: () => Promise<TelegramLinkCodeResult>;
  disconnectTelegram: () => Promise<MutationResult>;
  sendTelegramDigestNow: () => Promise<MutationResult>;
  sendTelegramBirthdaysNow: () => Promise<MutationResult>;
  sendTelegramTestMessage: () => Promise<MutationResult>;
  setTelegramMutationsEnabled: (enabled: boolean) => Promise<MutationResult>;
  preferences: NotificationPreferenceRecord[];
  updateTelegramPreferences: (preferences: NotificationPreferenceInput[]) => Promise<MutationResult>;
};

function isConnected(channel: NotificationChannelRecord) {
  return channel.isEnabled && Boolean(channel.telegramChatId);
}

export function NotificationPreferencesPanel({
  channel,
  timeZone,
  generateTelegramLinkCode,
  disconnectTelegram,
  sendTelegramDigestNow,
  sendTelegramBirthdaysNow,
  sendTelegramTestMessage,
  setTelegramMutationsEnabled,
  preferences: initialPreferences,
  updateTelegramPreferences,
}: Props) {
  const router = useRouter();
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isSendingDigestNow, setIsSendingDigestNow] = useState(false);
  const [isSendingBirthdaysNow, setIsSendingBirthdaysNow] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUpdatingMutations, setIsUpdatingMutations] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const [mutationsEnabled, setMutationsEnabled] = useState(channel.telegramMutationsEnabled);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);

  const connected = isConnected(channel);

  async function handleGenerateTelegramLinkCode() {
    setIsGeneratingLink(true);
    try {
      const result = await generateTelegramLinkCode();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setGeneratedLink({
        code: result.code,
        expiresAt: result.expiresAt,
      });
      toast.success(result.message);
    } finally {
      setIsGeneratingLink(false);
    }
  }

  async function handleSendTelegramTestMessage() {
    setIsSendingTest(true);
    try {
      const result = await sendTelegramTestMessage();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    } finally {
      setIsSendingTest(false);
    }
  }

  async function handleSendTelegramDigestNow() {
    setIsSendingDigestNow(true);
    try {
      const result = await sendTelegramDigestNow();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    } finally {
      setIsSendingDigestNow(false);
    }
  }

  async function handleSendTelegramBirthdaysNow() {
    setIsSendingBirthdaysNow(true);
    try {
      const result = await sendTelegramBirthdaysNow();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    } finally {
      setIsSendingBirthdaysNow(false);
    }
  }

  async function handleDisconnectTelegram() {
    if (!window.confirm("¿Desconectar Telegram de esta cuenta?")) return;

    setIsDisconnecting(true);
    try {
      const result = await disconnectTelegram();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setGeneratedLink(null);
      toast.success(result.message);
      router.refresh();
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleMutationsToggle(nextEnabled: boolean) {
    setIsUpdatingMutations(true);
    const previous = mutationsEnabled;
    setMutationsEnabled(nextEnabled);
    try {
      const result = await setTelegramMutationsEnabled(nextEnabled);
      if (!result.ok) {
        setMutationsEnabled(previous);
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    } finally {
      setIsUpdatingMutations(false);
    }
  }

  async function handlePreferenceToggle(eventType: string, enabled: boolean) {
    const next = notificationEventCatalog.map((event) => {
      const existing = preferences.find((preference) => preference.eventType === event.eventType);
      return {
        ...(existing ?? {
          id: `draft:${event.eventType}`,
          userId: channel.userId,
          channelType: "TELEGRAM",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        eventType: event.eventType,
        enabled: event.eventType === eventType ? enabled : existing?.enabled ?? event.defaultEnabled,
        minPriority: existing?.minPriority ?? event.defaultMinPriority,
      };
    });
    setPreferences(next);
    setIsUpdatingPreferences(true);
    const result = await updateTelegramPreferences(next.map((preference) => ({ eventType: preference.eventType, enabled: preference.enabled, minPriority: preference.minPriority as NotificationPreferenceInput["minPriority"] })));
    setIsUpdatingPreferences(false);
    if (!result.ok) {
      setPreferences(preferences);
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
  }

  async function handleCopyLinkCode() {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.code);
      toast.success("Código copiado.");
    } catch {
      toast.error("No se pudo copiar el código.");
    }
  }

  function formatExpiresAt(value: string) {
    try {
      return new Date(value).toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return value;
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/85 shadow-sm">
        <CardHeader className="border-b border-border/70">
              <CardTitle className="flex items-center gap-2 text-base"><BellRing className="size-4" />Preferencias de entrega</CardTitle>
              <CardDescription>Controla qué eventos puede enviar Telegram. El brief sale a las 08:00 y los cumpleaños a las 09:00.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 md:grid-cols-2">
          {notificationEventCatalog.map((event) => {
            const preference = preferences.find((item) => item.eventType === event.eventType);
            const enabled = preference?.enabled ?? event.defaultEnabled;
            return (
              <label key={event.eventType} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <Checkbox checked={enabled} disabled={isUpdatingPreferences || !connected} onCheckedChange={(checked) => void handlePreferenceToggle(event.eventType, Boolean(checked))} />
                <span className="space-y-1"><span className="block text-sm font-medium">{event.title}</span><span className="block text-xs text-muted-foreground">{event.description}</span></span>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/85 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4" />
            Canal disponible
          </CardTitle>
          <CardDescription>
            Telegram ya puede vincularse con tu cuenta. Aquí ves el estado y haces pruebas o
            envíos manuales del resumen diario. El envío manual no consume el envío automático
            del cron.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">Telegram</span>
              <Badge variant={connected ? "default" : "outline"} className="rounded-full">
                {connected ? "Conectado" : "Desconectado"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {connected
                ? `Chat vinculado: ${channel.telegramChatId ?? "—"}`
                : "Aún no hay enlace activo. Genera un código y usa /link en Telegram para conectarlo."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2 rounded-2xl border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
              {connected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Listo para recibir el resumen diario
                </>
              ) : (
                <>
                  <MessageSquareOff className="size-4 text-muted-foreground" />
                  Vinculación pendiente
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateTelegramLinkCode}
                disabled={isGeneratingLink}
              >
                <Link2 className="mr-2 size-4" />
                {isGeneratingLink ? "Generando…" : "Generar código"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSendTelegramDigestNow}
                disabled={isSendingDigestNow || !connected}
              >
                <Send className="mr-2 size-4" />
                {isSendingDigestNow ? "Enviando…" : "Enviar ahora"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSendTelegramBirthdaysNow}
                disabled={isSendingBirthdaysNow || !connected}
              >
                <Send className="mr-2 size-4" />
                {isSendingBirthdaysNow ? "Enviando…" : "Cumpleaños de hoy"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSendTelegramTestMessage}
                disabled={isSendingTest || !connected}
              >
                <Send className="mr-2 size-4" />
                {isSendingTest ? "Enviando…" : "Mensaje de prueba"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDisconnectTelegram}
                disabled={isDisconnecting || !connected}
              >
                <Unplug className="mr-2 size-4" />
                {isDisconnecting ? "Desconectando…" : "Desconectar"}
              </Button>
            </div>
          </div>
          </CardContent>
        </Card>

      <Card className="border-border/60 bg-card/85 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4" />
            Cambios reales por Telegram
          </CardTitle>
          <CardDescription>
            Las consultas y avisos siguen activos. Este interruptor permite o bloquea pagos y
            capturas confirmadas desde Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 px-4 py-3">
            <Checkbox
              id="telegram-mutations-enabled"
              checked={mutationsEnabled}
              disabled={isUpdatingMutations || !connected}
              onCheckedChange={(checked) => handleMutationsToggle(Boolean(checked))}
            />
            <div className="space-y-1">
              <Label htmlFor="telegram-mutations-enabled" className="text-sm font-medium">
                Permitir cambios reales desde Telegram
              </Label>
              <p className="text-sm text-muted-foreground">
                {connected
                  ? "Si lo activas, /pago y /confirmar podrán registrar cambios reales después de completar el borrador."
                  : "Conecta primero Telegram para habilitar esta opción."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/85 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4" />
            Horario fijo
          </CardTitle>
          <CardDescription>
            Este horario se muestra solo como referencia. Si hace falta cambiarlo, lo ajustamos
            manualmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-5 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-full">
              {timeZone}
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              08:00 brief · 09:00 cumpleaños
            </Badge>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-foreground">
            <p className="font-medium">Horarios automáticos fijos</p>
            <p className="mt-1 text-muted-foreground">
              El brief se enviará a las 08:00 y los cumpleaños a las 09:00, hora de Ciudad de México.
              La selección de hora individual está temporalmente desactivada.
            </p>
          </div>
          <p>
            El envío manual sigue disponible y no altera el envío automático del día.
          </p>
        </CardContent>
      </Card>

      {generatedLink ? (
        <Card className="border-border/60 bg-card/85 shadow-sm">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <Copy className="size-4" />
              Código de enlace
            </CardTitle>
            <CardDescription>
              Envía este código por Telegram con el comando{" "}
              <span className="font-medium text-foreground">/link</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <Input readOnly value={generatedLink.code} className="font-mono tracking-[0.2em]" />
              <Button type="button" variant="outline" onClick={handleCopyLinkCode}>
                <Copy className="mr-2 size-4" />
                Copiar
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Expira el {formatExpiresAt(generatedLink.expiresAt)}. Si se vence, genera uno nuevo.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
