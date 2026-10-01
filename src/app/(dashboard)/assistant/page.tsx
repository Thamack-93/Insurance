import { AssistantConsole } from "@/components/assistant/assistant-console";
import { getAssistantHomeSnapshot } from "@/lib/assistant";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";

export default async function AssistantPage() {
  const user = await requireUserOrRedirect();
  const organization = await requireOrganizationContext();
  const organizationKind = await withTenantTransaction(organization, (tx) => tx.organization.findUnique({ where: { id: organization.organizationId }, select: { kind: true } }));
  const noraCapability = await resolveOrganizationCapability(organization.organizationId, "NORA");
  if (!noraCapability.enabled) {
    return <div className="rounded-xl border border-cyan-300/60 bg-cyan-50 p-6 text-sm text-cyan-950 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">Nora está deshabilitada en la organización de demostración para proteger la separación de datos y acciones externas.</div>;
  }
  const snapshot = await getAssistantHomeSnapshot({
    id: user.id,
    role: organization.membershipRole === "AGENT" ? "AGENT" : "ADMIN",
    organizationId: organization.organizationId,
  });

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-col">
      <AssistantConsole snapshot={snapshot} userId={user.id} organizationId={organization.organizationId} demoMode={organizationKind?.kind === "DEMO"} />
    </div>
  );
}
