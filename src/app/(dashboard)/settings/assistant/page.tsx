import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import { requireAdminOrRedirect } from "@/lib/auth";
import { listAssistantReports } from "@/lib/assistant-reports";
import { formatDate } from "@/lib/dates";
import { AssistantReportActionButtons } from "@/components/assistant/report-action-buttons";
import {
  archiveAssistantReportAction,
  closeAssistantReportAction,
  deleteAssistantReportAction,
  reopenAssistantReportAction,
} from "./actions";

function statusTone(status: string): "secondary" | "outline" | "destructive" {
  if (status === "OPEN") return "secondary";
  if (status === "COLLECTING") return "outline";
  if (status === "RESOLVED") return "secondary";
  if (status === "ARCHIVED") return "outline";
  if (status === "DELETED") return "destructive";
  return "outline";
}

function ReportList({
  reports,
}: {
  reports: Awaited<ReturnType<typeof listAssistantReports>>;
}) {
  return (
    <div className="space-y-4">
      {reports.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No hay reportes en esta categoría.</CardContent>
        </Card>
      ) : null}
      {reports.map((report) => (
        <Card key={report.id} className="border-border/70 bg-card/90">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {report.title}
                  <Badge variant={statusTone(report.status)} className="rounded-full">
                    {report.status}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    v{report.version}
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1">
                  {report.themeLabel} · {report.kind} · {report.signalCount} señales
                </CardDescription>
              </div>
              <AssistantReportActionButtons
                id={report.id}
                closeAction={report.status === "OPEN" || report.status === "COLLECTING" ? closeAssistantReportAction : undefined}
                archiveAction={report.status !== "ARCHIVED" && report.status !== "DELETED" ? archiveAssistantReportAction : undefined}
                reopenAction={report.status === "RESOLVED" || report.status === "ARCHIVED" ? reopenAssistantReportAction : undefined}
                deleteAction={report.status !== "DELETED" ? deleteAssistantReportAction : undefined}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-5 text-sm">
            <p>{report.summary}</p>
            <p className="text-muted-foreground">Recomendación: {report.recommendation}</p>
            <p className="text-muted-foreground">Plan: {report.plan}</p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Última señal: {formatDate(new Date(report.lastSignalAt))}</span>
              <span>Inicio: {formatDate(new Date(report.firstSignalAt))}</span>
              {report.openedAt ? <span>Apertura: {formatDate(new Date(report.openedAt))}</span> : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function AssistantSettingsPage() {
  await requireAdminOrRedirect();
  const [incidents, suggestions] = await Promise.all([
    listAssistantReports({ kind: "INCIDENT", limit: 100 }),
    listAssistantReports({ kind: "SUGGESTION", limit: 100 }),
  ]);

  const openIncidents = incidents.filter((report) => report.status === "OPEN" || report.status === "COLLECTING").length;
  const openSuggestions = suggestions.filter((report) => report.status === "OPEN" || report.status === "COLLECTING").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Sistema"
        title="Backlog de IA"
        description="Aquí viven los incidentes y sugerencias que el asistente va acumulando por tema."
        actions={<RefreshPageButton label="Actualizar" />}
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Incidentes abiertos</CardDescription>
            <CardTitle className="text-3xl">{openIncidents}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Sugerencias abiertas</CardDescription>
            <CardTitle className="text-3xl">{openSuggestions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total incidentes</CardDescription>
            <CardTitle className="text-3xl">{incidents.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total sugerencias</CardDescription>
            <CardTitle className="text-3xl">{suggestions.length}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <UrlTabs defaultValue="incidentes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="incidentes">Incidentes</TabsTrigger>
          <TabsTrigger value="sugerencias">Sugerencias</TabsTrigger>
        </TabsList>
        <TabsContent value="incidentes" className="space-y-4">
          <ReportList reports={incidents} />
        </TabsContent>
        <TabsContent value="sugerencias" className="space-y-4">
          <ReportList reports={suggestions} />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
