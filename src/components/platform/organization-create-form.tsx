"use client";

import { useState, useTransition } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganizationAction } from "@/app/(platform)/platform/organizations/actions";

export function OrganizationCreateForm() {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [timeZone, setTimeZone] = useState("America/Mexico_City");
  const [currency, setCurrency] = useState("MXN");
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createOrganizationAction({
        requestId: crypto.randomUUID(),
        name,
        slug,
        ownerName,
        ownerEmail,
        timeZone,
        defaultCurrency: currency,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      if (result.temporaryPassword) setCredential({ email: result.ownerEmail, password: result.temporaryPassword });
      setName("");
      setSlug("");
      setOwnerName("");
      setOwnerEmail("");
    });
  }

  async function copyCredential() {
    if (!credential) return;
    await navigator.clipboard.writeText(`${credential.email} / ${credential.password}`);
    toast.success("Credencial copiada.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="organization-name">Nombre</Label><Input id="organization-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></div>
          <div className="space-y-1"><Label htmlFor="organization-slug">Identificador URL</Label><Input id="organization-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="se genera del nombre" maxLength={80} /></div>
          <div className="space-y-1"><Label htmlFor="organization-currency">Moneda</Label><Input id="organization-currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} required /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="organization-timezone">Zona horaria</Label><Input id="organization-timezone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required /></div>
          <div className="space-y-1"><Label htmlFor="owner-name">Nombre del propietario</Label><Input id="owner-name" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required maxLength={160} /></div>
          <div className="space-y-1"><Label htmlFor="owner-email">Correo del propietario</Label><Input id="owner-email" type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} required maxLength={254} /></div>
        </div>
        <Button type="submit" disabled={pending}><ShieldCheck className="mr-2 size-4" />{pending ? "Creando…" : "Crear organización"}</Button>
      </form>
      <aside className="rounded-xl border bg-muted/30 p-5 text-sm">
        <h2 className="font-semibold">Garantías de la operación</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground"><li>Se crea vacía y con un solo propietario activo.</li><li>No se copian clientes, pólizas, pagos ni documentos.</li><li>La contraseña temporal solo se muestra una vez.</li><li>El propietario debe cambiarla al entrar.</li></ul>
        {credential ? <div className="mt-5 space-y-2 rounded-lg border bg-background p-3 text-foreground"><p className="font-medium">Credencial temporal</p><p className="text-xs text-muted-foreground">{credential.email}</p><code className="block rounded bg-muted px-2 py-1 font-mono">{credential.password}</code><Button type="button" variant="outline" size="sm" onClick={copyCredential}><Copy className="mr-2 size-4" />Copiar</Button></div> : null}
      </aside>
    </div>
  );
}
