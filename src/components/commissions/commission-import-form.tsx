"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function CommissionImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/commissions/statements/import", { method: "POST", body: form });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No se pudo importar el estado.");
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "No se pudo importar el estado.");
    } finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <input ref={inputRef} type="file" accept=".csv,.xlsx,.pdf" className="max-w-56 text-sm" aria-label="Estado de comisiones" />
    <Button type="button" variant="outline" onClick={submit} disabled={busy}>{busy ? "Importando…" : "Importar estado"}</Button>
  </div>;
}
