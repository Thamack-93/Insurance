"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Copy, FileUp, MessageSquare, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { prepareRenewalQuoteShare, prepareRenewalWhatsAppContact } from "@/app/(dashboard)/renewals/actions";
import { isSafeWhatsAppUrl } from "@/lib/whatsapp";
import { validateRenewalQuotePdf } from "@/lib/renewal-whatsapp";
import { cn } from "@/lib/utils";
import type { RenewalStage } from "@/lib/renewal-board.logic";

type Intent = "CONTACT" | "QUOTE";
type Handoff = "NATIVE_SHARE" | "WHATSAPP_FALLBACK";

export function RenewalWhatsAppAssistant({
  policyId,
  clientName,
  stage,
  className,
}: {
  policyId: string;
  clientName: string;
  stage: RenewalStage;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<Intent>(stage === "QUOTED" ? "QUOTE" : "CONTACT");
  const [file, setFile] = useState<File | null>(null);
  const [nativeShare, setNativeShare] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturedPhone, setCapturedPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<Handoff | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFile(null); setMessage(null); setFallbackUrl(null); setError(null); setNativeShare(false); setCapturedPhone(""); setPendingHandoff(null);
  }

  function showResult(result: Awaited<ReturnType<typeof prepareRenewalWhatsAppContact>> | Awaited<ReturnType<typeof prepareRenewalQuoteShare>>) {
    if (result.outcome === "ERROR") { setError(result.error); return; }
    if (result.outcome === "CAPTURE_PHONE") { setCaptureOpen(true); return; }
    if (result.outcome === "OPEN_WHATSAPP") {
      if (!isSafeWhatsAppUrl(result.url)) { setError("El destino de WhatsApp no es seguro."); return; }
      setMessage(result.message);
      if (intent === "QUOTE") setFallbackUrl(result.url);
      else window.location.assign(result.url);
      return;
    }
    setMessage(result.message);
  }

  function prepareContact(phone?: string) {
    startTransition(async () => showResult(await prepareRenewalWhatsAppContact({ policyId, ...(phone ? { capturedPhone: phone } : {}) })));
  }

  function prepareQuote(handoff: Handoff, phone?: string) {
    startTransition(async () => showResult(await prepareRenewalQuoteShare({ policyId, handoff, ...(phone ? { capturedPhone: phone } : {}) })));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(null); setMessage(null); setFallbackUrl(null);
    if (!selected) { setFile(null); return; }
    const validationError = validateRenewalQuotePdf(selected);
    if (validationError) { setFile(null); setError(validationError); return; }
    setFile(selected);
    let supported = false;
    try { supported = typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [selected] }); } catch { supported = false; }
    setNativeShare(supported);
    setPendingHandoff(supported ? "NATIVE_SHARE" : "WHATSAPP_FALLBACK");
    prepareQuote(supported ? "NATIVE_SHARE" : "WHATSAPP_FALLBACK");
  }

  async function sharePdf() {
    if (!file || !message || !navigator.share) return;
    try {
      await navigator.share({ files: [file], text: message, title: "Cotización de renovación" });
      toast.success("Compartir preparado. Confirma WhatsApp y el cliente correcto.");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") toast.message("Compartir cancelado; no se envió nada.");
      else setError("No se pudo abrir la hoja de compartir. Puedes copiar el mensaje y adjuntar el PDF manualmente.");
    }
  }

  async function copyMessage() {
    if (!message) return;
    try { await navigator.clipboard.writeText(message); toast.success("Mensaje copiado."); } catch { setError("No se pudo copiar el mensaje."); }
  }

  function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCaptureOpen(false); setError(null);
    if (intent === "CONTACT") prepareContact(capturedPhone);
    else prepareQuote(pendingHandoff ?? "WHATSAPP_FALLBACK", capturedPhone);
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={cn("h-8 gap-1 px-3 text-xs", className)} onClick={() => { reset(); setIntent(stage === "QUOTED" ? "QUOTE" : "CONTACT"); setOpen(true); }} aria-label="WhatsApp">
        <MessageSquare className="size-3.5" /> WhatsApp
      </Button>
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>WhatsApp de renovación</DialogTitle>
            <DialogDescription>Prepara un contacto manual para {clientName}. PolicyDesk no envía mensajes ni adjunta archivos automáticamente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant={intent === "CONTACT" ? "default" : "outline"} className="h-auto min-h-20 justify-start gap-2 whitespace-normal text-left" onClick={() => { setIntent("CONTACT"); setError(null); }}>
              <MessageSquare className="size-5" /> <span><span className="block font-medium">Contactar al cliente</span><span className="block text-xs opacity-80">Abrir WhatsApp con mensaje editable</span></span>
            </Button>
            <Button type="button" variant={intent === "QUOTE" ? "default" : "outline"} className="h-auto min-h-20 justify-start gap-2 whitespace-normal text-left" onClick={() => { setIntent("QUOTE"); setError(null); }}>
              <Share2 className="size-5" /> <span><span className="block font-medium">Compartir cotización</span><span className="block text-xs opacity-80">Elegir un PDF de este dispositivo</span></span>
            </Button>
          </div>
          {intent === "CONTACT" ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p>Se usará el teléfono principal y después el secundario. Si falta, te pediremos capturarlo.</p><Button type="button" className="mt-3" onClick={() => prepareContact()} disabled={isPending}>{isPending ? "Preparando..." : "Abrir WhatsApp"}</Button></div>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <label htmlFor={`renewal-pdf-${policyId}`} className="flex cursor-pointer items-center gap-2 font-medium"><FileUp className="size-4" /> Seleccionar PDF (máximo 15 MB)</label>
              <Input id={`renewal-pdf-${policyId}`} type="file" accept="application/pdf,.pdf" onChange={handleFileChange} disabled={isPending} />
              {file ? <p className="text-xs text-muted-foreground">Archivo seleccionado: {file.name}</p> : null}
              {nativeShare && message ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Se abrirá la hoja de compartir del dispositivo. Elige WhatsApp y confirma el cliente correcto.</p><Button type="button" onClick={sharePdf} disabled={isPending}><Share2 className="size-4" /> Compartir PDF</Button></div> : null}
              {!nativeShare && fallbackUrl && isSafeWhatsAppUrl(fallbackUrl) ? <div className="space-y-2"><p>Abre WhatsApp y adjunta manualmente el PDF seleccionado. Confirma el cliente correcto.</p><a className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href={fallbackUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a></div> : null}
              {message ? <div className="space-y-2"><p className="whitespace-pre-wrap rounded-md bg-background p-2 text-xs">{message}</p><Button type="button" variant="outline" size="sm" onClick={copyMessage}><Copy className="size-3.5" /> Copiar mensaje</Button></div> : null}
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cerrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Agregar teléfono para WhatsApp</DialogTitle><DialogDescription>Se guardará como teléfono principal del cliente con una validación optimista.</DialogDescription></DialogHeader><form onSubmit={submitCapture} className="space-y-4"><Input autoFocus type="tel" inputMode="tel" placeholder="55 1234 5678" value={capturedPhone} onChange={(event) => setCapturedPhone(event.target.value)} aria-label="Teléfono mexicano" /><DialogFooter><Button type="button" variant="outline" onClick={() => setCaptureOpen(false)}>Cancelar</Button><Button type="submit" disabled={isPending || !capturedPhone.trim()}>{isPending ? "Guardando..." : "Guardar y continuar"}</Button></DialogFooter></form></DialogContent>
      </Dialog>
    </>
  );
}
