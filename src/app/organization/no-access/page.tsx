import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OrganizationNoAccessPage() {
  const user = await getCurrentUser();
  if (!user || !user.active) redirect("/login");

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Sin organización activa</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tu cuenta todavía no tiene una membership activa. Contacta a un administrador de plataforma.</p>
        {user.platformRole === "SUPERADMIN" ? <Link className="mt-5 inline-flex text-sm font-medium text-primary underline" href="/platform">Ir a Plataforma</Link> : null}
      </div>
    </main>
  );
}
