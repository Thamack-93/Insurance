"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PolicyPdfCaptureCorrectionProposal } from "@/lib/policy-pdf-capture.shared";

export function PolicyCaptureCorrectionCard({
  proposal,
  onApply,
  onOpenCapture,
}: {
  proposal: PolicyPdfCaptureCorrectionProposal;
  onApply: () => void;
  onOpenCapture: () => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-ai/30 bg-ai/5 shadow-sm">
      <div className="border-b border-ai/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Corrección propuesta para la captura</p>
          <Badge variant="outline" className="rounded-full border-ai/30 text-[10px] uppercase tracking-wide">Sin guardar</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{proposal.summary}</p>
      </div>
      <div className="space-y-2 px-4 py-4">
        {proposal.changes.length > 0 ? proposal.changes.map((change) => (
          <div key={change.field} className="rounded-xl border border-border/60 bg-background/80 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{change.label}</p>
            <p className="mt-1 text-sm font-medium">{change.after || "Sin dato"}</p>
            {change.before ? <p className="mt-0.5 text-xs text-muted-foreground">Antes: {change.before}</p> : null}
            <p className="mt-1 text-[11px] text-muted-foreground">{change.reason}</p>
          </div>
        )) : <p className="text-sm text-muted-foreground">No hay un cambio inequívoco para aplicar automáticamente.</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-ai/20 px-4 py-3">
        <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onOpenCapture}>Revisar captura</Button>
        {proposal.changes.length > 0 ? <Button type="button" size="sm" className="rounded-full" onClick={onApply}>Aplicar al borrador</Button> : null}
      </div>
    </div>
  );
}
