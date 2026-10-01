"use client";

import { useState, useTransition, type FormEvent } from "react";
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

export function WhatsAppReminderButton({ receiptId, className, demoPreview }: { receiptId: string; className?: string; demoPreview?: { clientName: string; receiptNumber: string; policyNumber: string } }) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturedPhone, setCapturedPhone] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  function openPreparedWhatsApp(url: string) {
    setCaptureOpen(false);
    if (!isSafeWhatsAppUrl(url)) {
      toast.error("No se pudo validar la liga de WhatsApp.");
      return;
    }
    setPreparedUrl(url);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) toast.info("WhatsApp quedó listo. Usa el enlace para abrirlo.");
  }

  function prepare(phone?: string) {
    startTransition(async () => {
      const result = await prepareWhatsAppReceiptReminder({
        receiptId,
        ...(phone ? { capturedPhone: phone } : {}),
      });

      if (!result.ok) {
        if (phone) setCaptureError(result.error);
        else toast.error(result.error);
        return;
      }

      if (result.outcome === "CAPTURE_PHONE") {
        setCaptureError(null);
        setCaptureOpen(true);
        return;
      }

      openPreparedWhatsApp(result.url);
    });
  }

  function handleCaptureSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCaptureError(null);
    prepare(capturedPhone);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("h-8 gap-1 px-3 text-xs", className)}
        onClick={() => {
          if (demoPreview) {
            setPreviewMessage(`Hola ${demoPreview.clientName}, te compartimos un recordatorio de demostración sobre el recibo ${demoPreview.receiptNumber} de la póliza ${demoPreview.policyNumber}. No se envió ningún mensaje.`);
            setPreviewOpen(true);
            return;
          }
          prepare();
        }}
        disabled={isPending}
        aria-label="Avisar por WhatsApp"
      >
        <MessageSquare className="size-3.5" />
        {isPending ? "Preparando..." : "Avisar por WhatsApp"}
      </Button>

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
}
