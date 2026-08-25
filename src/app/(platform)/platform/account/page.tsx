import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

export const dynamic = "force-dynamic";

export default async function PlatformAccountPage() {
  const user = await requireSuperAdminOrRedirect();
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6"><header><p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Cuenta master</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Mi cuenta</h1><p className="mt-2 text-sm text-muted-foreground">Administra las credenciales de la sesión de plataforma.</p></header>{user.mustChangePassword ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"><h2 className="font-semibold">Cambio obligatorio</h2><p className="mt-1 text-sm">La contraseña temporal debe reemplazarse antes de operar.</p></section> : null}<section className="rounded-2xl border bg-card p-6"><h2 className="font-semibold">Datos de la cuenta</h2><p className="mt-1 text-sm text-muted-foreground">{user.name} · {user.email} · Superadmin</p></section><section className="rounded-2xl border bg-card p-6"><h2 className="font-semibold">Cambiar contraseña</h2><p className="mt-1 text-sm text-muted-foreground">Usa al menos 8 caracteres y combina letras y números.</p><div className="mt-5"><ChangePasswordForm /></div></section></div>;
}
