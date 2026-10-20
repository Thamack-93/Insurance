import { connection } from "next/server";
import { PageHeader } from "@/components/layout/page-header";
import { CommissionRulesManager } from "@/components/commissions/commission-rules-manager";
import { requireOrganizationRoleOrRedirect, withTenantTransaction } from "@/lib/organization-context";

export default async function CommissionRulesPage() {
  await connection();
  const context = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const insurers = await withTenantTransaction(context, (db) => db.insurer.findMany({
    where: { organizationId: context.organizationId, status: "ACTIVE" },
    select: { id: true, name: true, commissionRules: true, commissionRulesVersion: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }));
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6"><PageHeader eyebrow="Finanzas" title="Reglas de comisión" description="Configura tasas por aseguradora, ramo, plan, modalidad, unidad y frecuencia de pago." /><CommissionRulesManager insurers={insurers} /></div>;
}
