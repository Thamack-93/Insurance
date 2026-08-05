import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  await requireSuperAdminOrRedirect();
  const db = getDb();
  const organizations = await db.organization.findMany({
    select: { id: true, name: true, slug: true, status: true, _count: { select: { memberships: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Plataforma</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Administración global</h1>
          <p className="mt-2 text-sm text-muted-foreground">Metadatos de organizaciones y memberships. Los registros operativos requieren una organización seleccionada.</p>
        </div>
        <ShieldCheck className="size-7 text-primary" aria-hidden />
      </header>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumen de plataforma">
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Organizaciones</p><p className="mt-1 text-2xl font-semibold">{organizations.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Activas</p><p className="mt-1 text-2xl font-semibold">{organizations.filter((item) => item.status === "ACTIVE").length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Memberships</p><p className="mt-1 text-2xl font-semibold">{organizations.reduce((sum, item) => sum + item._count.memberships, 0)}</p></div>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="platform-organizations">
        <div className="border-b p-4"><h2 id="platform-organizations" className="font-semibold">Organizaciones</h2></div>
        <div className="divide-y">
          {organizations.map((organization) => (
            <div key={organization.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3"><Building2 className="size-5 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0"><p className="truncate font-medium">{organization.name}</p><p className="truncate text-sm text-muted-foreground">{organization.slug} · {organization._count.memberships} memberships</p></div></div>
              <span className="text-sm text-muted-foreground">{organization.status}</span>
            </div>
          ))}
        </div>
      </section>
      <Link href="/organization/select" className="text-sm font-medium text-primary underline">Seleccionar una organización operativa</Link>
    </div>
  );
}
