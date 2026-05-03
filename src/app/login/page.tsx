import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Iniciar sesión · PG Insurance",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirect && params.redirect.startsWith("/") ? params.redirect : "/dashboard";

  const session = await getSession();
  if (session) {
    redirect(redirectTo);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-100 via-white to-stone-100 px-4 py-16">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">PG Insurance</p>
          <h1 className="mt-2 text-2xl font-semibold">Acceso al cockpit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingresa con tu cuenta para continuar.
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-white p-6 shadow-sm dark:bg-stone-900/60">
          <LoginForm redirectTo={redirectTo} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          ¿Olvidaste tu contraseña? Contacta al administrador.
        </p>
      </div>
    </main>
  );
}
