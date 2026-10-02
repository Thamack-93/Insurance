import { PageHeader } from "@/components/layout/page-header";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { OperationalInsightsPanel } from "@/components/reports/operational-insights-panel";
import { reportsNavigation } from "@/lib/navigation";
import { getOperationalInsights } from "@/lib/operational-insights";
import { readOperationalInsightGroup, readOperationalInsightPage } from "@/lib/operational-insights.logic";

export default async function OperationalInsightsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const group = readOperationalInsightGroup(params.group);
  const page = readOperationalInsightPage(params.page);
  const data = await getOperationalInsights({ group, page });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        eyebrow="Operación"
        title="Insights operativos"
        description="Revisa renovaciones, cobranza, siniestros y pendientes con señales que llevan a la acción actual."
      />
      <LocalNavigation items={reportsNavigation} label="Secciones de reportes" />
      <OperationalInsightsPanel data={data} />
    </div>
  );
}
