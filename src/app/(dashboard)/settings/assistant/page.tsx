import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import { requireAdminOrRedirect } from "@/lib/auth";
import { listAssistantReports } from "@/lib/assistant-reports";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { formatDate } from "@/lib/dates";
import { AssistantReportActionButtons } from "@/components/assistant/report-action-buttons";
import { Gauge, ShieldCheck } from "lucide-react";
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

function formatDurationMs(value: number) {
  if (!Number.isFinite(value)) return "sin dato";
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1000).toFixed(1)} s`;
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
            <details className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
              <summary className="cursor-pointer font-medium">Evidencia y señales ({report.signalCount})</summary>
              <div className="mt-3 space-y-3">
                {report.evidence.slice(-10).reverse().map((entry, index) => (
                  <div key={`${report.id}-evidence-${index}`} className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{entry.signalKind ?? "SEÑAL"}</span>
                      <span>{entry.source ?? "sistema"}</span>
                      {entry.createdAt ? <span>{formatDate(new Date(entry.createdAt))}</span> : null}
                    </div>
                    <p className="mt-1 font-medium">{entry.title ?? "Señal registrada"}</p>
                    {entry.summary ? <p className="mt-1 text-muted-foreground">{entry.summary}</p> : null}
                    {entry.diagnostic ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        <p className="font-medium">Diagnóstico</p>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <span>Código: {entry.diagnostic.code ?? "unknown"}</span>
                          <span>Operación: {entry.diagnostic.operation ?? "sin dato"}</span>
                          <span>Modelo: {entry.diagnostic.model ?? "sin dato"}</span>
                          <span>Duración: {entry.diagnostic.durationMs ? formatDurationMs(entry.diagnostic.durationMs) : "sin dato"}</span>
                          <span>Folio: {entry.diagnostic.diagnosticId ?? "sin folio"}</span>
                          <span>Reporte: {entry.diagnostic.reportId ?? report.id}</span>
                        </div>
                        {entry.diagnostic.summary ? <p className="mt-2">{entry.diagnostic.summary}</p> : null}
                        {entry.diagnostic.attempts?.length ? (
                          <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                            <summary className="cursor-pointer font-medium">Intentos ({entry.diagnostic.attempts.length})</summary>
                            <div className="mt-2 space-y-2">
                              {entry.diagnostic.attempts.map((attempt, index) => (
                                <div key={`${entry.diagnostic!.diagnosticId ?? report.id}-attempt-${index}`} className="rounded-md border border-amber-100 bg-white/80 px-2 py-2">
                                  <div className="flex flex-wrap gap-2">
                                    <span className="font-medium">Intento {index + 1}</span>
                                    <span>{attempt.model}</span>
                                    <span>{attempt.outcome}</span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-amber-900/80">
                                    {attempt.code ? <span>Código: {attempt.code}</span> : null}
                                    <span>Duración: {formatDurationMs(attempt.durationMs)}</span>
                                    {attempt.statusCode ? <span>HTTP {attempt.statusCode}</span> : null}
                                    {attempt.finishReason ? <span>Finish: {attempt.finishReason}</span> : null}
                                  </div>
                                  {attempt.responsePreview ? <p className="mt-1 break-words">{attempt.responsePreview}</p> : null}
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function AssistantSettingsPage() {
  await requireAdminOrRedirect();
  const aiStatus = getAssistantAiConnectionStatus();
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
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
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2"><Gauge className="size-4" /> Rate limits IA</CardDescription>
            <CardTitle className="text-3xl">Sin límite</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Sin cuota de uso por usuario. Permanecen autenticación, same-origin y límite técnico de payload.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Estado IA</CardDescription>
            <CardTitle className="text-3xl">{aiStatus.available ? "Conectada" : "Offline"}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-2">
              <Badge variant={aiStatus.available ? "default" : "outline"} className="rounded-full">
                {aiStatus.authMode}
              </Badge>
              <Badge variant="secondary" className="rounded-full">
                {aiStatus.model}
              </Badge>
            </div>
            <p>
              {aiStatus.available
                ? `La IA está lista para responder y generar mejoras con fallback a ${aiStatus.fallbackModels.join(", ")}.`
                : "La IA no está disponible todavía. Revisa credenciales o entorno."}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card className="border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> Controles activos</CardTitle>
          <CardDescription>
            Nora bloquea temas ajenos a PolicyDesk, limita el contexto a la cartera autorizada y nunca aplica cambios de PDF sin confirmación humana.
          </CardDescription>
        </CardHeader>
      </Card>

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
