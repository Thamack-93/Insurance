"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fixCommissionVehicleClass } from "@/app/(dashboard)/commissions/actions";
import { VEHICLE_UNIT_CLASS_OPTIONS } from "@/lib/vehicle-unit-classes";

type VehicleOption = { index: number; description: string };

export function CommissionUnitClassFix({
  policyId,
  receiptId,
  vehicles,
}: {
  policyId: string;
  receiptId: string;
  vehicles: VehicleOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!vehicles.length) return null;

  function save(index: number) {
    const unitClass = selected[index];
    if (!unitClass) return;
    setMessage("");
    startTransition(async () => {
      const result = await fixCommissionVehicleClass({ policyId, receiptId, vehicleIndex: index, unitClass });
      if (!result.saved) {
        setMessage(result.message);
        return;
      }
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-medium">Completa el tipo de unidad y recalcula:</p>
      {vehicles.map((vehicle) => (
        <div key={`${vehicle.index}-${vehicle.description}`} className="flex flex-wrap items-center gap-2">
          <span className="min-w-36 flex-1">{vehicle.description || `Vehículo ${vehicle.index + 1}`}</span>
          <select
            aria-label={`Tipo de unidad para ${vehicle.description || `vehículo ${vehicle.index + 1}`}`}
            value={selected[vehicle.index] ?? ""}
            onChange={(event) => setSelected((current) => ({ ...current, [vehicle.index]: event.target.value }))}
            className="h-9 rounded-md border border-amber-400 bg-background px-2 text-foreground"
          >
            <option value="">Selecciona tipo</option>
            {VEHICLE_UNIT_CLASS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={!selected[vehicle.index] || isPending} onClick={() => save(vehicle.index)}>
            {isPending ? "Guardando…" : "Guardar y recalcular"}
          </Button>
        </div>
      ))}
      {message ? <p role="status" aria-live="polite" className="text-xs">{message}</p> : null}
    </div>
  );
}
