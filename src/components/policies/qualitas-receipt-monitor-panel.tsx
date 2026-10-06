"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { checkQualitasReceipt, confirmQualitasReceiptPayment, configureQualitasReceiptMonitor } from "@/app/(dashboard)/policies/qualitas-actions";

type CheckResult = Extract<Awaited<ReturnType<typeof checkQualitasReceipt>>, { ok: true }>["result"];

export function QualitasReceiptMonitorPanel({
  policyId,
  monitorEnabled,
  featureEnabled,
}: {
  policyId: string;
  monitorEnabled: boolean;
  featureEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(monitorEnabled);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const canEnableMonitor = result?.status === "PENDING" || result?.status === "LIKELY_ADVANCED";

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
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm" aria-labelledby="qualitas-monitor-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 id="qualitas-monitor-title" className="font-semibold">Recibos domiciliados Quálitas</h3>
          <p className="text-sm text-muted-foreground">Consulta el siguiente vencimiento en el portal. La consulta no modifica ni registra pagos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={check} disabled={!featureEnabled || pending}>
            {pending ? "Consultando…" : "Consultar portal"}
          </Button>
          <Button type="button" variant={enabled ? "secondary" : "outline"} onClick={toggleMonitor} disabled={(!featureEnabled && !enabled) || pending || (!enabled && !canEnableMonitor)}>
            {enabled ? "Desactivar revisión diaria" : "Activar revisión diaria"}
          </Button>
        </div>
      </div>
      {!featureEnabled ? <p className="mt-3 text-sm text-muted-foreground">La integración de consulta aún no está habilitada.</p> : null}
      {featureEnabled && !enabled && !canEnableMonitor ? <p className="mt-3 text-sm text-muted-foreground">Consulta y valida Quálitas para esta póliza antes de activar la revisión diaria.</p> : null}
      {message ? <p className="mt-3 text-sm" role="status">{message}</p> : null}
      {result?.targetReceipt ? (
        <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-sm">
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
    </section>
  );
}
