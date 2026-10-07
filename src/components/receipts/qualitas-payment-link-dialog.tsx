"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { requestQualitasPaymentLink } from "@/app/(dashboard)/receipts/actions";
import { cn } from "@/lib/utils";

type Recipient = "CLIENT" | "AGENT";
type Channel = "EMAIL" | "WHATSAPP";

type Props = {
  receipt: {
    id: string;
    receiptNumber: string;
    dueDate: string;
    amount: number;
    currency: string;
    client: { fullName: string; email?: string | null; phone?: string | null };
    policy: { policyNumber: string };
    insurer: { name: string };
  };
  agent: { email: string | null; phone: string | null };
  clientRecipientEnabled: boolean;
  enabled: boolean;
  className?: string;
  triggerMode?: "button" | "controlled";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function maskedEmail(value: string) {
  const [local, domain] = value.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskedPhone(value: string) {
  return `••••••${value.replace(/\D/g, "").slice(-4)}`;
}

export function QualitasPaymentLinkDialog({ receipt, agent, clientRecipientEnabled, enabled, className, triggerMode = "button", open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [pending, startTransition] = useTransition();

  if (!enabled) return null;

  const contacts = {
    CLIENT: { email: receipt.client.email?.trim() || null, phone: receipt.client.phone?.trim() || null, label: "Cliente" },
    AGENT: { email: agent.email?.trim() || null, phone: agent.phone?.trim() || null, label: "Agente" },
  };
  const current = recipient ? contacts[recipient] : null;
  const destination = current && channel === "EMAIL" ? current.email : current && channel === "WHATSAPP" ? current.phone : null;
  const canClient = clientRecipientEnabled && Boolean(contacts.CLIENT.email || contacts.CLIENT.phone);
  const canAgent = Boolean(contacts.AGENT.email || contacts.AGENT.phone);

  function reset() {
    setRecipient(null);
    setChannel(null);
  }

  function submit() {
    if (!recipient || !channel || !destination) return;
    startTransition(async () => {
      const result = await requestQualitasPaymentLink({ receiptId: receipt.id, recipientType: recipient, deliveryChannel: channel });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.auditStatus === "PENDING") toast.warning(result.message);
      else if (result.outcome === "SUCCESS") toast.success(result.message);
      else if (result.outcome === "UNCERTAIN_POST_SUBMISSION" || result.outcome === "ALREADY_IN_PROGRESS") toast.warning(result.message);
      else toast.error(result.message);
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      {triggerMode === "button" ? (
        <DialogTrigger render={<Button size="sm" variant="outline" className={cn("h-8 gap-1 px-3 text-xs", className)} />}>
          <Link2 className="size-4" />
          Liga de pago Quálitas
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar liga de pago Quálitas</DialogTitle>
          <DialogDescription>La solicitud es para la póliza; el recibo solo aporta el contexto de cobranza.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-muted/40 p-3">
            <p className="font-medium">Póliza {receipt.policy.policyNumber}</p>
            <p className="text-muted-foreground">{receipt.client.fullName} · Recibo {receipt.receiptNumber} · vence {formatDate(receipt.dueDate)}</p>
            <p className="text-muted-foreground">Contexto: {formatCurrency(receipt.amount, receipt.currency)}</p>
          </div>

          <div className="space-y-2">
            <p className="font-medium">Enviar a</p>
            <div className="grid grid-cols-2 gap-2">
              {canClient ? <Button type="button" variant={recipient === "CLIENT" ? "default" : "outline"} onClick={() => { setRecipient("CLIENT"); setChannel(null); }}>Cliente</Button> : null}
              {canAgent ? <Button type="button" variant={recipient === "AGENT" ? "default" : "outline"} onClick={() => { setRecipient("AGENT"); setChannel(null); }}>Agente</Button> : null}
            </div>
            {!canClient && !canAgent ? <p className="text-destructive">Actualiza un correo o teléfono válido en PolicyDesk antes de continuar.</p> : null}
          </div>

          {current ? (
            <div className="space-y-2">
              <p className="font-medium">Canal para {current.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {current.email ? <Button type="button" variant={channel === "EMAIL" ? "default" : "outline"} onClick={() => setChannel("EMAIL")}>Correo · {maskedEmail(current.email)}</Button> : null}
                {current.phone ? <Button type="button" variant={channel === "WHATSAPP" ? "default" : "outline"} onClick={() => setChannel("WHATSAPP")}>WhatsApp · {maskedPhone(current.phone)}</Button> : null}
              </div>
            </div>
          ) : null}

          {recipient && channel && destination ? (
            <div className="rounded-md border p-3">
              <p className="font-medium">Confirmar solicitud</p>
              <p className="text-muted-foreground">{contacts[recipient].label} · {channel === "EMAIL" ? maskedEmail(destination) : maskedPhone(destination)}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button type="button" onClick={submit} disabled={pending || !recipient || !channel || !destination}>
              {pending ? "Solicitando..." : "Solicitar liga"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
