"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resetTenantUserPasswordFromPlatform } from "@/app/(dashboard)/platform/actions";

export function PlatformPasswordReset({ userId, name, email }: { userId: string; name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [credential, setCredential] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    startTransition(async () => {
      const result = await resetTenantUserPasswordFromPlatform({ userId, confirmEmail, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCredential(result.tempPassword);
      toast.success(result.message);
      setConfirmEmail("");
      setReason("");
    });
  }

  async function copy() {
    if (!credential) return;
    await navigator.clipboard.writeText(`${email} / ${credential}`);
    toast.success("Credencial copiada.");
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setCredential(null); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" title={`Resetear contraseña de ${email}`} aria-label={`Resetear contraseña de ${email}`} />}>
        <KeyRound className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset tenant</DialogTitle>
          <DialogDescription>{name} · {email}. Se invalidarán sus sesiones y deberá cambiar la temporal al entrar.</DialogDescription>
        </DialogHeader>
        {credential ? (
          <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
            <p>Contraseña temporal (solo visible ahora):</p>
            <code className="block rounded bg-background px-2 py-1 font-mono">{credential}</code>
            <Button type="button" variant="outline" onClick={copy}><Copy className="mr-2 size-4" />Copiar</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1"><Label htmlFor={`confirm-email-${userId}`}>Confirma el correo</Label><Input id={`confirm-email-${userId}`} type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} autoComplete="off" /></div>
            <div className="space-y-1"><Label htmlFor={`reset-reason-${userId}`}>Motivo</Label><Input id={`reset-reason-${userId}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. recuperación solicitada por el Owner" /></div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
          {!credential ? <Button type="button" onClick={reset} disabled={pending || !confirmEmail || reason.trim().length < 8}>{pending ? "Generando…" : "Generar temporal"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
