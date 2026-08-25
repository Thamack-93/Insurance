import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getPlatformBillingOverview } from "@/lib/platform-billing";
import { PlatformBillingPanel } from "@/components/platform/platform-billing-panel";

export const dynamic = "force-dynamic";

export default async function PlatformBillingPage() {
  await requireSuperAdminOrRedirect();
  const overview = await getPlatformBillingOverview();
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6"><header><p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Control de plataforma</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Facturación</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">MRR, cobros y planes internos por moneda. Las mutaciones permanecen protegidas por la configuración del entorno.</p></header><PlatformBillingPanel overview={overview} /></div>;
}
