import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OrganizationNoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !user.active) redirect("/login");
  const reason = (await searchParams).reason;

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Sin organización activa</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {reason === "corrupt"
            ? "Tu cuenta tiene accesos incompatibles. El acceso operativo está bloqueado hasta que un administrador de plataforma corrija la asignación."
            : "Tu cuenta todavía no tiene acceso activo a una organización. Contacta a un administrador de plataforma."}
        </p>
        {user.platformRole === "SUPERADMIN" ? <Link className="mt-5 inline-flex text-sm font-medium text-primary underline" href="/platform">Ir a Plataforma</Link> : null}
      </div>
    </main>
  );
}
