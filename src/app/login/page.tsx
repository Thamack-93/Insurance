import { redirect } from "next/navigation";
import { ShieldCheck } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";
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
    redirect(redirectTo);
  }

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="text-center">
          <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.28em] text-primary">PolicyDesk</p>
          <h1 className="font-display mt-2 text-3xl font-medium tracking-tight">Acceso a tu centro operativo</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ingresa con tu cuenta para continuar.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.08)]">
          <LoginForm redirectTo={redirectTo} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          ¿Olvidaste tu contraseña? Contacta al administrador.
        </p>
      </div>
    </main>
  );
}
