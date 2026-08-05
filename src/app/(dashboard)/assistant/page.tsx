import { AssistantConsole } from "@/components/assistant/assistant-console";
import { getAssistantHomeSnapshot } from "@/lib/assistant";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";

export default async function AssistantPage() {
  const user = await requireUserOrRedirect();
  const organization = await requireOrganizationContext();
  const snapshot = await getAssistantHomeSnapshot({
    id: user.id,
    role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    organizationId: organization.organizationId,
  });

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-col">
      <AssistantConsole snapshot={snapshot} userId={user.id} />
    </div>
  );
}
