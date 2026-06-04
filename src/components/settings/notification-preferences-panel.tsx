"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SectionCard } from "@/components/pages-secondary/panels";
import { priorityOptions } from "@/lib/domain-options";
import {
  notificationEventCatalog,
  type NotificationChannelRecord,
  type NotificationPreferenceInput,
  type NotificationPreferencesSnapshot,
} from "@/lib/notification-foundation-shared";
import { TIME_ZONE_OPTIONS } from "@/lib/time-zones";
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
  snapshot: NotificationPreferencesSnapshot;
  timeZone: string;
  saveNotificationPreferences: (preferences: NotificationPreferenceInput[]) => Promise<MutationResult>;
  generateTelegramLinkCode: () => Promise<TelegramLinkCodeResult>;
  disconnectTelegram: () => Promise<MutationResult>;
  sendTelegramDigestNow: () => Promise<MutationResult>;
  sendTelegramTestMessage: () => Promise<MutationResult>;
  updateNotificationTimezone: (timeZone: string) => Promise<MutationResult>;
};

type PreferenceRow = NotificationPreferenceInput;

function buildInitialRows(snapshot: NotificationPreferencesSnapshot): PreferenceRow[] {
  return notificationEventCatalog.map((meta) => {
    const existing = snapshot.preferences.find(
      (preference) => preference.eventType === meta.eventType && preference.channelType === "TELEGRAM",
    );
    const existingMinPriority = existing?.minPriority as PreferenceRow["minPriority"] | undefined;

    return {
      eventType: meta.eventType,
      enabled: existing?.enabled ?? meta.defaultEnabled,
      minPriority: existingMinPriority ?? meta.defaultMinPriority,
      quietHoursStart: existing?.quietHoursStart ?? "",
      quietHoursEnd: existing?.quietHoursEnd ?? "",
    };
  });
}

function toLabel(eventType: string) {
  return notificationEventCatalog.find((item) => item.eventType === eventType)?.title ?? eventType;
}

function toDescription(eventType: string) {
  return (
    notificationEventCatalog.find((item) => item.eventType === eventType)?.description ??
    "Preferencia de notificación."
  );
}

function isConnected(channel: NotificationChannelRecord) {
  return channel.isEnabled && Boolean(channel.telegramChatId);
}

export function NotificationPreferencesPanel({
  snapshot,
  timeZone,
  saveNotificationPreferences,
  generateTelegramLinkCode,
  disconnectTelegram,
  sendTelegramDigestNow,
  sendTelegramTestMessage,
  updateNotificationTimezone,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<PreferenceRow[]>(() => buildInitialRows(snapshot));
  const [selectedTimeZone, setSelectedTimeZone] = useState(timeZone);
  const [isPending, startTransition] = useTransition();
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isSendingDigestNow, setIsSendingDigestNow] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingTimeZone, setIsSavingTimeZone] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );

  const connected = isConnected(snapshot.channel);
  const enabledCount = useMemo(
    () => rows.filter((row) => row.enabled).length,
    [rows],
  );

  function updateRow(index: number, patch: Partial<PreferenceRow>) {
    setRows((current) =>
      current.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const result = await saveNotificationPreferences(rows);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    });
  }

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

  async function handleSaveTimeZone() {
    setIsSavingTimeZone(true);
    try {
      const result = await updateNotificationTimezone(selectedTimeZone);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    } finally {
      setIsSavingTimeZone(false);
    }
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
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4" />
            Canal disponible
          </CardTitle>
          <CardDescription>
            Telegram ya puede vincularse con tu cuenta. Aquí ves el estado, generas códigos y
            haces pruebas de conexión.
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
                ? `Chat vinculado: ${snapshot.channel.telegramChatId ?? "—"}`
                : "Aún no hay enlace activo. Genera un código y usa /link en Telegram para conectarlo."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2 rounded-2xl border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
              {connected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Listo para recibir mensajes
                </>
              ) : (
                <>
                  <MessageSquareOff className="size-4 text-muted-foreground" />
                  Vinculación pendiente
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleGenerateTelegramLinkCode} disabled={isGeneratingLink}>
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
            <Globe2 className="size-4" />
            Zona horaria
          </CardTitle>
          <CardDescription>
            Quiet hours se interpretan usando esta zona horaria. Si cambias aquí, el rango de no molestar cambia
            sin modificar tus preferencias.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Zona horaria
            </Label>
            <Select value={selectedTimeZone} onValueChange={(value) => setSelectedTimeZone(value ?? timeZone)}>
              <SelectTrigger className="w-full sm:w-[280px]">
                <SelectValue placeholder="Selecciona una zona" />
              </SelectTrigger>
              <SelectContent>
                {TIME_ZONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} ({option.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              La zona actual es <span className="font-medium text-foreground">{timeZone}</span>.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={handleSaveTimeZone} disabled={isSavingTimeZone}>
            {isSavingTimeZone ? "Guardando…" : "Guardar zona"}
          </Button>
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
              Envía este código por Telegram con el comando <span className="font-medium text-foreground">/link</span>.
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

      <SectionCard
        title="Preferencias"
        description="Activa o desactiva eventos y define el umbral mínimo por prioridad."
        action={
          <Button type="submit" form="notification-preferences-form" disabled={isPending}>
            <BellRing className="mr-2 size-4" />
            {isPending ? "Guardando…" : "Guardar preferencias"}
          </Button>
        }
      >
        <form id="notification-preferences-form" onSubmit={handleSubmit}>
          <div className="space-y-0 divide-y divide-border/70">
            {rows.map((row, index) => (
              <div
                key={row.eventType}
                className="grid gap-4 px-5 py-4 lg:grid-cols-[1.8fr_0.55fr_0.7fr_0.7fr_0.7fr] lg:items-center"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{toLabel(row.eventType)}</p>
                    <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
                      Telegram
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{toDescription(row.eventType)}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={row.enabled}
                    onCheckedChange={(checked) => updateRow(index, { enabled: checked === true })}
                    aria-label={`Activar ${toLabel(row.eventType)}`}
                  />
                  <span className="text-sm text-muted-foreground">Activo</span>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Prioridad mínima
                  </Label>
                  <Select
                    value={row.minPriority}
                    onValueChange={(value) =>
                      updateRow(index, {
                        minPriority: value as PreferenceRow["minPriority"],
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    No molestar desde
                  </Label>
                  <Input
                    type="time"
                    value={row.quietHoursStart ?? ""}
                    onChange={(event) => updateRow(index, { quietHoursStart: event.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    No molestar hasta
                  </Label>
                  <Input
                    type="time"
                    value={row.quietHoursEnd ?? ""}
                    onChange={(event) => updateRow(index, { quietHoursEnd: event.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {enabledCount} de {rows.length} preferencias activas para Telegram. Los horarios usan la zona
              elegida arriba.
            </div>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
