"use client";

import { forwardRef, useImperativeHandle, useState, useTransition, type FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prepareWhatsAppReceiptReminder } from "@/app/(dashboard)/receipts/actions";
import { isSafeWhatsAppUrl } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export type WhatsAppReminderHandle = { trigger: () => void };

type WhatsAppReminderButtonProps = {
  receiptId: string;
  className?: string;
  demoPreview?: { clientName: string; receiptNumber: string; policyNumber: string };
  showTrigger?: boolean;
};

export const WhatsAppReminderButton = forwardRef<WhatsAppReminderHandle, WhatsAppReminderButtonProps>(function WhatsAppReminderButton(
  { receiptId, className, demoPreview, showTrigger = true },
  ref,
) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturedPhone, setCapturedPhone] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  function openPreparedWhatsApp(url: string, popup: Window | null) {
    setCaptureOpen(false);
    if (!isSafeWhatsAppUrl(url)) {
      popup?.close();
      toast.error("No se pudo validar la liga de WhatsApp.");
      return;
    }
    if (popup && !popup.closed) {
      popup.location.href = url;
      setPreparedUrl(null);
      return;
    }
    setPreparedUrl(url);
    toast.info("WhatsApp quedó listo. Usa el enlace para abrirlo.");
  }

  function prepare(phone?: string, popup: Window | null = null) {
    startTransition(async () => {
      const result = await prepareWhatsAppReceiptReminder({
        receiptId,
        ...(phone ? { capturedPhone: phone } : {}),
      });

      if (!result.ok) {
        popup?.close();
        if (phone) setCaptureError(result.error);
        else toast.error(result.error);
        return;
      }

      if (result.outcome === "CAPTURE_PHONE") {
        popup?.close();
        setCaptureError(null);
        setCaptureOpen(true);
        return;
      }

      openPreparedWhatsApp(result.url, popup);
    });
  }

  function handleCaptureSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCaptureError(null);
    prepare(capturedPhone);
  }

  function handleTrigger() {
    if (demoPreview) {
      setPreviewMessage(`Hola ${demoPreview.clientName}, te compartimos un recordatorio de demostración sobre el recibo ${demoPreview.receiptNumber} de la póliza ${demoPreview.policyNumber}. No se envió ningún mensaje.`);
      setPreviewOpen(true);
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    prepare(undefined, popup);
  }

  useImperativeHandle(ref, () => ({ trigger: handleTrigger }));

  return (
    <>
      {showTrigger ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("h-8 gap-1 px-3 text-xs", className)}
          onClick={handleTrigger}
          disabled={isPending}
          aria-label="Avisar por WhatsApp"
        >
          <MessageSquare className="size-3.5" />
          {isPending ? "Preparando..." : "Avisar por WhatsApp"}
        </Button>
      ) : null}

      {preparedUrl ? (
        <a
          href={preparedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2"
          onClick={() => setPreparedUrl(null)}
        >
          Continuar con WhatsApp
        </a>
      ) : null}

      <Dialog
        open={captureOpen}
        onOpenChange={(open) => {
          setCaptureOpen(open);
          if (!open) setCaptureError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar teléfono para WhatsApp</DialogTitle>
            <DialogDescription>
              No encontramos un teléfono mexicano válido. Se guardará como teléfono principal del cliente antes de abrir WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCaptureSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor={`whatsapp-phone-${receiptId}`} className="text-sm font-medium">
                Teléfono
              </label>
              <Input
                id={`whatsapp-phone-${receiptId}`}
                type="tel"
                inputMode="tel"
                autoFocus
                placeholder="55 1234 5678"
                value={capturedPhone}
                onChange={(event) => {
                  setCapturedPhone(event.target.value);
                  setCaptureError(null);
                }}
                aria-invalid={Boolean(captureError)}
              />
              {captureError ? <p className="text-sm text-destructive">{captureError}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCaptureOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || !capturedPhone.trim()}>
                {isPending ? "Guardando..." : "Guardar y abrir WhatsApp"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vista previa de WhatsApp</DialogTitle>
            <DialogDescription>Solo texto sintético local. No se abre WhatsApp ni se envía o comparte información.</DialogDescription>
          </DialogHeader>
          {previewMessage ? <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm" role="status">{previewMessage}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>Cerrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
