import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Iniciar sesión · PolicyDesk",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirect && params.redirect.startsWith("/") ? params.redirect : "/today";

  const user = await getCurrentUser();
  if (user && user.active) {
    if (user.platformRole === "SUPERADMIN") redirect("/platform");
    const memberships = await getDb().organizationMembership.count({
      where: { userId: user.id, active: true, organization: { status: "ACTIVE" } },
    });
    redirect(memberships === 0 ? "/organization/no-access" : memberships === 1 ? redirectTo : "/organization/select");
  }

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#06283b] text-white">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <p className="mt-3 text-sm font-semibold tracking-tight text-foreground">PolicyDesk</p>
          <h1 className="mt-2 text-2xl font-semibold">Acceso a tu centro operativo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingresa con tu cuenta para continuar.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <LoginForm redirectTo={redirectTo} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          ¿Olvidaste tu contraseña? Contacta al administrador.
        </p>
      </div>
    </main>
  );
}
