"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { clearRenewalManualFollowUp, scheduleRenewalManualFollowUp } from "@/app/(dashboard)/renewals/actions";
import { CalendarClock, ChevronDown } from "@/components/icons";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { businessToday, formatBusinessDateInput } from "@/lib/business-dates";
import { renewalFollowUpShortcutDate, type RenewalFollowUpShortcut } from "@/lib/renewal-board.logic";

type RenewalFollowUpMenuProps = {
  policyId: string;
  policyNumber: string;
  currentDueDate?: string | null;
  currentNotes?: string | null;
};

const shortcutLabels: Array<{ value: RenewalFollowUpShortcut; label: string }> = [
  { value: "tomorrow", label: "Mañana" },
  { value: "three-days", label: "En 3 días" },
  { value: "one-week", label: "En 1 semana" },
];

export function RenewalFollowUpMenu({ policyId, policyNumber, currentDueDate, currentNotes }: RenewalFollowUpMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [customDate, setCustomDate] = useState(currentDueDate ?? formatBusinessDateInput(renewalFollowUpShortcutDate("tomorrow")));
  const [notes, setNotes] = useState(currentNotes ?? "");

  function openCustomDate() {
    setCustomDate(currentDueDate ?? formatBusinessDateInput(renewalFollowUpShortcutDate("tomorrow")));
    setNotes(currentNotes ?? "");
    setCustomOpen(true);
  }

  function save(dueDate: string, nextNotes: string) {
    startTransition(async () => {
      const result = await scheduleRenewalManualFollowUp({ policyId, dueDate, notes: nextNotes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setCustomOpen(false);
      router.refresh();
    });
  }

  function chooseShortcut(shortcut: RenewalFollowUpShortcut) {
    save(formatBusinessDateInput(renewalFollowUpShortcutDate(shortcut, businessToday())), currentNotes ?? "");
  }

  async function clear() {
    const result = await clearRenewalManualFollowUp(policyId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" disabled={pending} aria-label={`Seguimiento de ${policyNumber}`} />}>
          <CalendarClock className="size-3.5" aria-hidden="true" />
          Seguimiento
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{currentDueDate ? "Reprogramar" : "Programar"}</DropdownMenuLabel>
          {shortcutLabels.map((shortcut) => (
            <DropdownMenuItem key={shortcut.value} onSelect={() => chooseShortcut(shortcut.value)}>
              {shortcut.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={openCustomDate}>Otra fecha</DropdownMenuItem>
          {currentDueDate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setClearOpen(true)}>
                Quitar seguimiento
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{currentDueDate ? "Reprogramar seguimiento" : "Programar seguimiento"}</DialogTitle>
            <DialogDescription>Elige la fecha de próximo contacto para la póliza {policyNumber}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="space-y-2 text-sm font-medium" htmlFor={`renewal-follow-up-date-${policyId}`}>
              Fecha de seguimiento
              <Input
                id={`renewal-follow-up-date-${policyId}`}
                type="date"
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <label className="space-y-2 text-sm font-medium" htmlFor={`renewal-follow-up-notes-${policyId}`}>
              Nota opcional
              <Textarea
                id={`renewal-follow-up-notes-${policyId}`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={500}
                placeholder="Ej. Llamar después de la junta del cliente"
                disabled={pending}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomOpen(false)} disabled={pending}>Cancelar</Button>
            <Button type="button" onClick={() => save(customDate, notes)} disabled={pending || !customDate}>
              {pending ? "Guardando..." : "Guardar seguimiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Quitar seguimiento de ${policyNumber}`}
        description="Se cerrará sólo el siguiente seguimiento manual. El recordatorio automático de “sin avance” no cambiará."
        confirmLabel="Quitar seguimiento"
        cancelLabel="Cancelar"
        onConfirm={clear}
        destructive
      />
    </>
  );
}
