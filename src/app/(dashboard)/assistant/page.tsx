import { PageHeader } from "@/components/layout/page-header";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="IA"
        title="Asistente"
        description="Consulta rápida, PDFs asistidos y señales que alimentan el backlog de mejoras."
        actions={<RefreshPageButton label="Actualizar" />}
      />
      <AssistantConsole snapshot={snapshot} />
    </div>
  );
}
