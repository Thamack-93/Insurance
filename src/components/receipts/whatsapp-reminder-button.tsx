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

export function WhatsAppReminderButton({ receiptId }: { receiptId: string }) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturedPhone, setCapturedPhone] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openPreparedWhatsApp(url: string) {
    setCaptureOpen(false);
    window.location.assign(url);
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
        className="h-8 gap-1 px-3 text-xs"
        onClick={() => prepare()}
        disabled={isPending}
        aria-label="Avisar por WhatsApp"
      >
        <MessageSquare className="size-3.5" />
        {isPending ? "Preparando..." : "Avisar por WhatsApp"}
      </Button>

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
    </>
  );
}
