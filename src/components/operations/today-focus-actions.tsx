"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordReceiptCollectionFollowUp } from "@/app/(dashboard)/receipts/actions";
import { scheduleRenewalManualFollowUp } from "@/app/(dashboard)/renewals/actions";
import { bulkUpdateWorkItemStatus } from "@/app/(dashboard)/tasks/actions";
import { updateClaimFollowUp, updateClaimRequirementFollowUp } from "@/app/(dashboard)/claims/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { businessToday, formatBusinessDateInput } from "@/lib/business-dates";
import { renewalFollowUpShortcutDate } from "@/lib/renewal-board.logic";
import type { FocusItemModel } from "@/lib/today-operations";

type FollowUpContext = NonNullable<FocusItemModel["actionContext"]>;

export function TodayFocusActions({ context }: { context: FollowUpContext }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("CONTACTED");
  const [date, setDate] = useState(formatBusinessDateInput(renewalFollowUpShortcutDate("tomorrow", businessToday())));
  const [notes, setNotes] = useState("");

  function save() {
    startTransition(async () => {
      const result = context.type === "collection"
        ? await recordReceiptCollectionFollowUp({
            receiptId: context.receiptId,
            outcome: outcome as "NO_ANSWER" | "CONTACTED" | "PROMISED_PAYMENT" | "DISPUTED" | "WRONG_CONTACT",
            notes,
            ...(outcome === "PROMISED_PAYMENT" ? { promisedPaymentDate: date } : { nextContactDate: date }),
          })
        : context.type === "renewal"
          ? await scheduleRenewalManualFollowUp({ policyId: context.policyId, dueDate: date, notes })
          : context.type === "claim"
            ? context.requirementId && context.requirementVersion !== undefined
              ? await updateClaimRequirementFollowUp({ claimId: context.claimId, itemId: context.requirementId, assignedToId: context.assignedToId, dueDate: date, expectedVersion: context.requirementVersion })
              : await updateClaimFollowUp({ claimId: context.claimId, assignedToId: context.assignedToId, dueDate: date, expectedVersion: context.expectedVersion })
          : null;

      if (!result) return;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  function complete() {
    if (context.type !== "work-item" || !context.canComplete) return;
    startTransition(async () => {
      const result = await bulkUpdateWorkItemStatus([context.workItemId], "RESOLVED");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pendiente completado.");
      router.refresh();
    });
  }

  const isCollection = context.type === "collection";
  const isRenewal = context.type === "renewal";
  const isClaim = context.type === "claim";
  const canUpdateClaim = !isClaim || context.canUpdate;
  const initialDate = formatBusinessDateInput(renewalFollowUpShortcutDate("tomorrow", businessToday()));

  return (
    <>
      {isCollection || isRenewal || (isClaim && context.canUpdate) ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => { setDate(initialDate); setNotes(""); setOutcome("CONTACTED"); setOpen(true); }}>
          {isClaim ? "Actualizar seguimiento" : "Registrar seguimiento"}
        </Button>
      ) : context.type === "work-item" && context.canComplete ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={complete}>
          {pending ? "Completando…" : "Completar pendiente"}
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCollection ? "Registrar seguimiento de cobranza" : isClaim ? "Actualizar seguimiento del siniestro" : "Programar seguimiento de renovación"}</DialogTitle>
            <DialogDescription>{context.clientName} · {context.recordLabel}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isCollection ? (
              <label className="block space-y-1 text-sm font-medium" htmlFor="today-follow-up-outcome">
                Resultado
                <select id="today-follow-up-outcome" className="h-10 w-full rounded-md border bg-background px-3" value={outcome} onChange={(event) => setOutcome(event.target.value)} disabled={pending}>
                  <option value="NO_ANSWER">Sin respuesta</option>
                  <option value="CONTACTED">Contactado</option>
                  <option value="PROMISED_PAYMENT">Prometió pago</option>
                  <option value="DISPUTED">En disputa</option>
                  <option value="WRONG_CONTACT">Contacto incorrecto</option>
                </select>
              </label>
            ) : null}
            <label className="block space-y-1 text-sm font-medium" htmlFor="today-follow-up-date">
              {isCollection && outcome === "PROMISED_PAYMENT" ? "Fecha prometida de pago" : isClaim ? "Nueva fecha límite" : "Próximo contacto"}
              <Input id="today-follow-up-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={pending} required />
            </label>
            <label className="block space-y-1 text-sm font-medium" htmlFor="today-follow-up-notes">
              Nota opcional
              <Textarea id="today-follow-up-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Agrega una nota breve" disabled={pending} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button type="button" onClick={save} disabled={pending || !date || !canUpdateClaim}>{pending ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
