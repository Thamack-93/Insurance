"use client";

import { useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PolicySearchDialog } from "@/components/policies/policy-search-dialog";
import type { GlobalSearchResult } from "@/lib/search";
import type { PolicyRenewalSource } from "@/lib/policy-renewal";

type PolicyRenewalSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  selectedPolicy?: PolicyRenewalSource | null;
  disabled?: boolean;
  allowClear?: boolean;
  searchScope?: "portfolio" | "all";
};

function toSourcePolicy(result: GlobalSearchResult): PolicyRenewalSource {
  const [clientName, insurerName] = (result.subtitle ?? "").split(" · ");
  return {
    id: result.id,
    policyNumber: result.title,
    clientId: "",
    clientName: clientName ?? "Sin cliente",
    insurerId: "",
    insurerName: insurerName ?? "Sin aseguradora",
    policyType: "AUTO",
    startDate: new Date(),
    endDate: new Date(),
    premiumAmount: 0,
    currency: "MXN",
    paymentFrequency: "ANNUAL",
    paymentPlan: null,
    insuredObject: result.policyObjectDescription ?? null,
    beneficiaryInfo: null,
    notes: null,
  };
}

export function PolicyRenewalSelector({
  value,
  onChange,
  selectedPolicy,
  disabled = false,
  allowClear = true,
  searchScope = "portfolio",
}: PolicyRenewalSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pickedPolicy, setPickedPolicy] = useState<PolicyRenewalSource | null>(() => selectedPolicy ?? null);
  const selectedLabel = pickedPolicy
    ? `${pickedPolicy.policyNumber} · ${pickedPolicy.clientName} · ${pickedPolicy.insurerName}`
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Renueva a</Label>
        {allowClear && value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onChange("");
              setPickedPolicy(null);
            }}
            disabled={disabled}
          >
            <X className="mr-1 size-3.5" />
            Limpiar
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
        {selectedLabel ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">
                Seleccionada
              </Badge>
              <span className="font-medium text-foreground">{pickedPolicy?.policyNumber}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {pickedPolicy?.clientName ?? "Sin cliente"} · {pickedPolicy?.insurerName ?? "Sin aseguradora"}
            </p>
            {pickedPolicy?.insuredObject ? (
              <p className="truncate text-xs text-muted-foreground" title={pickedPolicy.insuredObject}>
                {pickedPolicy.insuredObject}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Busca la póliza anterior que esta vigencia renueva.</p>
        )}

        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            className="bg-card/70"
            onClick={() => setOpen(true)}
            disabled={disabled}
          >
            <Link2 className="mr-2 size-4" />
            {selectedLabel ? "Cambiar vínculo" : "Buscar póliza"}
          </Button>
        </div>
      </div>

      <PolicySearchDialog
        open={open}
        onOpenChange={setOpen}
        title="Seleccionar póliza renovada"
        description="Busca la póliza anterior para enlazar esta nueva vigencia."
        placeholder="Póliza, objeto asegurado, cliente, aseguradora..."
        sourceLabel={selectedLabel ?? "Sin vínculo"}
        initialQuery={pickedPolicy?.policyNumber ?? ""}
        suggestions={pickedPolicy ? [pickedPolicy.policyNumber, pickedPolicy.insuredObject, pickedPolicy.clientName, pickedPolicy.insurerName].filter((value): value is string => Boolean(value)) : []}
        searchScope={searchScope}
        onSelect={async (result) => {
          const nextPolicy = toSourcePolicy(result);
          setPickedPolicy(nextPolicy);
          onChange(result.id);
          return true;
        }}
      />
    </div>
  );
}
