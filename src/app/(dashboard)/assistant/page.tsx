import { AssistantConsole } from "@/components/assistant/assistant-console";
import { getAssistantHomeSnapshot } from "@/lib/assistant";
import { requireUserOrRedirect } from "@/lib/auth";

export default async function AssistantPage() {
  const user = await requireUserOrRedirect();
  const snapshot = await getAssistantHomeSnapshot({
    id: user.id,
    role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
  });

  return (
    <div className="flex flex-col">
      <AssistantConsole snapshot={snapshot} userId={user.id} />
    </div>
  );
}
