"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { calculateReceiptCommissionAction } from "@/app/(dashboard)/receipts/actions";
import { Button } from "@/components/ui/button";

export function ReceiptCommissionCalculator({ receiptId, status, reason, canCalculate }: { receiptId: string; status: string; reason: string | null; canCalculate: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3 px-4 py-4">
      <div className="text-sm">
        <p className="font-medium">Cálculo: {status === "CALCULATED" ? "guardado" : status === "REVIEW" ? "requiere revisión" : "pendiente"}</p>
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
        {status === "CALCULATED" ? <p className="mt-1 text-muted-foreground">La comisión guardada conserva la regla y los datos usados al calcular.</p> : null}
      </div>
      {canCalculate ? <Button type="button" disabled={pending} onClick={() => startTransition(async () => {
        const result = await calculateReceiptCommissionAction(receiptId);
        if (result.ok) toast.success(result.message);
        else toast.error(result.error);
      })}>{pending ? "Calculando…" : status === "REVIEW" ? "Reintentar cálculo" : "Calcular comisión esperada"}</Button> : null}
    </div>
  );
}
