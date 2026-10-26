"use client";

import { confirmAutoBonusEvidenceBatch } from "./actions";
import { Button } from "@/components/ui/button";

type SellerOption = { id: string; name: string; email: string };

export function AutoBonusEvidenceBatchForm({ sellers }: { sellers: SellerOption[] }) {
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Confirmar Autos históricos por vendedor
      </summary>
      <form action={confirmAutoBonusEvidenceBatch} className="grid gap-4 border-t p-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Vendedor</span>
          <select name="sellerId" required defaultValue={sellers[0]?.id ?? ""} className="h-10 rounded-md border bg-background px-3" disabled={!sellers.length}>
            {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} · {seller.email}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Fuente de la revisión</span>
          <input name="sourceReference" required minLength={3} maxLength={500} placeholder="Ej. Inventario de autos revisado con Pedro, 26/10/2026" className="h-10 rounded-md border bg-background px-3" />
        </label>
        <div className="flex flex-col gap-3 border-t pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex max-w-3xl items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <input required type="checkbox" name="reviewAttestation" className="mt-0.5 accent-primary" />
            <span>Confirmo que la revisión cubre todas las pólizas Autos pagadas del vendedor en 2026. Las flotillas con 50 vehículos o más se excluirán automáticamente; las demás se marcarán elegibles según esta confirmación.</span>
          </label>
          <Button type="submit" disabled={!sellers.length} className="shrink-0">Guardar confirmación</Button>
        </div>
      </form>
    </details>
  );
}
