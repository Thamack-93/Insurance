import { AssistantConsole } from "@/components/assistant/assistant-console";
import { getAssistantHomeSnapshot } from "@/lib/assistant";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

export default async function AssistantPage() {
  const user = await requireUserOrRedirect();
  const organization = await requireOrganizationContext();
  const organizationKind = await withTenantTransaction(organization, (tx) => tx.organization.findUnique({ where: { id: organization.organizationId }, select: { kind: true } }));
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
