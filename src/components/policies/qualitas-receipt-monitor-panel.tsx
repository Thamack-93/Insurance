"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { BadgeCheck } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { checkQualitasReceipt, confirmQualitasReceiptPayment, configureQualitasReceiptMonitor } from "@/app/(dashboard)/policies/qualitas-actions";

type CheckResult = Extract<Awaited<ReturnType<typeof checkQualitasReceipt>>, { ok: true }>["result"];

export function QualitasReceiptMonitorPanel({
  policyId,
  policyNumber,
  monitorEnabled,
  featureEnabled,
  triggerMode = "button",
}: {
  policyId: string;
  policyNumber?: string;
  monitorEnabled: boolean;
  featureEnabled: boolean;
  triggerMode?: "button" | "menu-item";
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(monitorEnabled);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const canEnableMonitor = result?.status === "PENDING" || result?.status === "LIKELY_ADVANCED";

  if (!featureEnabled) return null;

  function check() {
    setMessage("");
    startTransition(async () => {
      const response = await checkQualitasReceipt(policyId);
      if (!response.ok) { setResult(null); setMessage(response.error); return; }
      setResult(response.result);
      if (response.result.status === "PENDING") setMessage("Quálitas todavía muestra el recibo local como pendiente.");
      else if (response.result.status === "LIKELY_ADVANCED") setMessage("Quálitas ya muestra la siguiente parcialidad. El recibo anterior probablemente se pagó.");
      else setMessage("No se pudo confirmar el estado con suficiente certeza. El recibo no cambió.");
    });
  }

  function toggleMonitor() {
    startTransition(async () => {
      const response = await configureQualitasReceiptMonitor(policyId, !enabled);
      if (!response.ok) { setMessage(response.error); return; }
      setEnabled(!enabled);
      setMessage(response.message);
      router.refresh();
    });
  }

  function confirmPayment() {
    if (!result?.observationId) return;
    startTransition(async () => {
      const response = await confirmQualitasReceiptPayment(result.observationId);
      if (!response.ok) { setMessage(response.error); return; }
      setMessage(response.message);
      setResult(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={triggerMode === "menu-item" ? <DropdownMenuItem className="gap-2" /> : <Button type="button" size="sm" variant="outline" className="rounded-full whitespace-nowrap" />}>
        <BadgeCheck className="size-4" />
        Verificar pago{policyNumber ? ` · ${policyNumber}` : ""}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recibos domiciliados Quálitas{policyNumber ? ` · ${policyNumber}` : ""}</DialogTitle>
          <DialogDescription>
            Consulta el siguiente vencimiento en el portal. La consulta no modifica ni registra pagos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!featureEnabled ? <p className="rounded-lg border border-muted px-3 py-2 text-sm text-muted-foreground">La integración de consulta aún no está habilitada.</p> : null}
          {featureEnabled && !enabled && !canEnableMonitor ? <p className="text-sm text-muted-foreground">Consulta y valida Quálitas para esta póliza antes de activar la revisión diaria.</p> : null}
          {message ? <p className="text-sm" role="status">{message}</p> : null}
          {result?.targetReceipt ? (
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Recibo {result.targetReceipt.receiptNumber} · vence {formatDate(result.targetReceipt.dueDate)}</p>
              <p className="text-muted-foreground">{formatCurrency(result.targetReceipt.amount, result.targetReceipt.currency)} · Consulta {formatDate(result.checkedAt)}</p>
              {result.portalDueDate ? <p className="text-muted-foreground">Siguiente vencimiento visto en Quálitas: {formatDate(result.portalDueDate)}</p> : null}
              {result.status === "LIKELY_ADVANCED" ? (
                <Button type="button" className="mt-3" onClick={confirmPayment} disabled={pending}>
                  Confirmar y registrar como Domiciliado
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={check} disabled={!featureEnabled || pending}>
            {pending ? "Consultando…" : "Consultar portal"}
          </Button>
          <Button type="button" variant={enabled ? "secondary" : "outline"} onClick={toggleMonitor} disabled={(!featureEnabled && !enabled) || pending || (!enabled && !canEnableMonitor)}>
            {enabled ? "Desactivar revisión diaria" : "Activar revisión diaria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
