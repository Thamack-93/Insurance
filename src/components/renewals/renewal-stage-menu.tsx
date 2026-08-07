"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "@/components/icons";
import { setRenewalStage } from "@/app/(dashboard)/renewals/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RENEWAL_STAGES, type RenewalStage } from "@/lib/domain-values";
import { isTerminalRenewalStage } from "@/lib/renewal-board.logic";
import { renewalStageLabel } from "@/lib/status";

type RenewalStageMenuProps = {
  policyId: string;
  policyNumber: string;
  stage: RenewalStage;
  /**
   * Cuando la renovación se marca como ganada y todavía no existe la póliza
   * nueva, se continúa en el alta de renovación de siempre.
   */
  captureHref?: string;
};

export function RenewalStageMenu({ policyId, policyNumber, stage, captureHref }: RenewalStageMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Una renovación ya resuelta no se mueve: su columna la determina la póliza
  // de renovación o la decisión de no renovar, no el tablero.
  if (isTerminalRenewalStage(stage)) return null;

  const move = (next: string) => {
    if (next === stage) return;

    // "Renovado" no es una etapa que se escriba: la renovación queda ganada
    // cuando existe la póliza nueva, así que se continúa en el alta de siempre.
    if (next === "WON") {
      if (!captureHref) {
        toast.error("Esta renovación ya tiene su póliza nueva.");
        return;
      }
      router.push(captureHref);
      return;
    }

    startTransition(async () => {
      const result = await setRenewalStage(policyId, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`Mover la renovación de ${policyNumber}. Etapa actual: ${renewalStageLabel(stage)}`}
          />
        }
      >
        Mover
        <ChevronDown className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup value={stage} onValueChange={move} aria-label="Etapa de renovación">
          {RENEWAL_STAGES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {renewalStageLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
