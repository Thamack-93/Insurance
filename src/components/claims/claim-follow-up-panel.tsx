"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateClaimFollowUp } from "@/app/(dashboard)/claims/actions";

export function ClaimFollowUpPanel({ claimId, version, assignedToId, dueDate, owners }: { claimId: string; version: number; assignedToId: string | null; dueDate: Date | null; owners: Array<{ id: string; name: string }> }) {
  const [owner, setOwner] = useState(assignedToId ?? "");
  const [deadline, setDeadline] = useState(dueDate ? dueDate.toISOString().slice(0, 10) : "");
  const [pending, startTransition] = useTransition();
  function save() {
    startTransition(async () => {
      const result = await updateClaimFollowUp({ claimId, assignedToId: owner || null, dueDate: deadline || null, expectedVersion: version });
      if (!result.ok) toast.error(result.error); else toast.success(result.message);
    });
  }
  return <Card><CardHeader><CardTitle>Seguimiento operativo</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
    <label className="text-sm">Responsable<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={owner} onChange={(event) => setOwner(event.target.value)} disabled={pending}><option value="">Sin responsable</option>{owners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="text-sm">Fecha límite<input className="mt-1 h-10 w-full rounded-md border bg-background px-3" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={pending} /></label>
    <Button type="button" onClick={save} disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
  </CardContent></Card>;
}
