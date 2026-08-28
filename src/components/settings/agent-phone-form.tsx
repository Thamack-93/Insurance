"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MutationResult } from "@/lib/mutation-utils";

export function AgentPhoneForm({ initialPhone, updateMyPhone }: {
  initialPhone: string | null;
  updateMyPhone: (input: { phone: string }) => Promise<MutationResult>;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateMyPhone({ phone });
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="agent-phone">Celular del agente</Label>
        <Input
          id="agent-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+52 55 1234 5678"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">Se reutiliza para WhatsApp en solicitudes de Quálitas. Déjalo vacío para eliminarlo.</p>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar teléfono"}</Button>
    </form>
  );
}
