import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getOrganizationOptions, resolveOrganizationContext } from "@/lib/organization-context";
import { roleLabel } from "@/lib/ui-labels";
import { clearSelectedOrganizationAction, selectOrganizationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrganizationSelectPage() {
  const user = await getCurrentUser();
  if (!user || !user.active) redirect("/login");
  const resolution = await resolveOrganizationContext();
  if (resolution.status === "ready") redirect("/today");
  if (resolution.status === "corrupt-memberships") redirect("/organization/no-access?reason=corrupt");
  const options = await getOrganizationOptions();
  if (options.length === 0) redirect("/organization/no-access");

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">PolicyDesk</p>
          <h1 className="mt-2 text-2xl font-semibold">Renueva tu contexto de organización</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tu cuenta pertenece a una sola organización. Confirma esa organización para reemplazar la selección obsoleta de tu sesión.</p>
          {resolution.status === "stale-selection" ? (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              La selección firmada ya no coincide con tu acceso activo. Renueva la sesión de forma explícita para continuar.
            </p>
          ) : null}
        </div>
        <div className="grid gap-3">
          {options.map((option) => (
            <form key={option.id} action={selectOrganizationAction}>
              <input type="hidden" name="organizationId" value={option.id} />
              <button type="submit" className="flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.name}</span>
                  <span className="block text-sm text-muted-foreground">{option.slug} · {roleLabel(option.role)} · Renovar sesión</span>
                </span>
              </button>
            </form>
          ))}
        </div>
        <form action={clearSelectedOrganizationAction}>
          <button type="submit" className="text-sm text-muted-foreground underline underline-offset-4">Cerrar el contexto seleccionado</button>
        </form>
      </div>
    </main>
  );
}
