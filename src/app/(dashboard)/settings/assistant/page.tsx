import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import { requireAdminOrRedirect } from "@/lib/auth";
import { listAssistantReports } from "@/lib/assistant-reports";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { listAssistantAiRuns } from "@/lib/assistant-ai-runs";
import { formatDate } from "@/lib/dates";
import { AssistantReportActionButtons } from "@/components/assistant/report-action-buttons";
import { Gauge, ShieldCheck } from "@/components/icons";
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

function formatTokenCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX");
}

function formatCostUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
}

function formatDurationMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
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
                          <span>Duración: {entry.diagnostic.durationMs ? `${(entry.diagnostic.durationMs / 1000).toFixed(1)} s` : "sin dato"}</span>
                          <span>Folio: {entry.diagnostic.diagnosticId ?? "sin folio"}</span>
                          <span>Reporte: {entry.diagnostic.reportId ?? report.id}</span>
                        </div>
                        {entry.diagnostic.summary ? <p className="mt-2">{entry.diagnostic.summary}</p> : null}
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

function AiRunList({
  runs,
}: {
  runs: Awaited<ReturnType<typeof listAssistantAiRuns>>;
}) {
  return (
    <div className="space-y-4">
      {runs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No hay corridas de IA registradas todavía.</CardContent>
        </Card>
      ) : null}
      {runs.map((run) => (
        <Card key={run.id} className="border-border/70 bg-card/90">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {run.operation}
                  <Badge variant={run.status === "SUCCEEDED" ? "default" : run.status === "FAILED" ? "destructive" : "outline"} className="rounded-full">
                    {run.status}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    {run.tier}
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1">
                  {run.requestedModel} · {run.attemptCount} intentos · {run.fallbackCount} fallback{run.fallbackCount === 1 ? "" : "s"}
                </CardDescription>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{formatDurationMs(run.durationMs ?? 0)}</p>
                <p>{formatDate(new Date(run.createdAt))}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Modelo final</p>
                <p className="mt-1 font-medium">{run.finalModel ?? "Sin dato"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Costo estimado</p>
                <p className="mt-1 font-medium">{formatCostUsd(run.estimatedCostUsd)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tokens</p>
                <p className="mt-1 font-medium">
                  {formatTokenCount(run.totalUsage?.totalTokens ?? run.usage?.totalTokens)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reporte</p>
                <p className="mt-1 font-medium">{run.reportId ?? "Sin reporte"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Intento final: {run.finishReason ?? "sin dato"}</span>
              <span>Fallo: {run.errorCode ?? "ninguno"}</span>
              <span>Folio corrida: {run.id}</span>
            </div>
            <details className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
              <summary className="cursor-pointer font-medium">Intentos ({run.attempts.length})</summary>
              <div className="mt-3 space-y-3">
                {run.attempts.map((attempt) => (
                  <div key={attempt.id} className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        #{attempt.attemptNumber} · {attempt.requestedModel}
                      </p>
                      <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
                        {attempt.status}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      <span>Tier: {attempt.tier}</span>
                      <span>Final: {attempt.finalModel ?? "sin dato"}</span>
                      <span>Motivo: {attempt.fallbackReason ?? "sin motivo"}</span>
                      <span>Duración: {formatDurationMs(attempt.durationMs ?? 0)}</span>
                      <span>Código: {attempt.code ?? "ok"}</span>
                      <span>Finish: {attempt.finishReason ?? "sin dato"}</span>
                    </div>
                    {attempt.usage ? (
                      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span>In: {formatTokenCount(attempt.usage.inputTokens)}</span>
                        <span>Out: {formatTokenCount(attempt.usage.outputTokens)}</span>
                        <span>Total: {formatTokenCount(attempt.usage.totalTokens)}</span>
                        <span>Costo: {formatCostUsd(attempt.usage.estimatedCostUsd)}</span>
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
  const aiRuns = await listAssistantAiRuns({ limit: 50 });

  const openIncidents = incidents.filter((report) => report.status === "OPEN" || report.status === "COLLECTING").length;
  const openSuggestions = suggestions.filter((report) => report.status === "OPEN" || report.status === "COLLECTING").length;
  const succeededRuns = aiRuns.filter((run) => run.status === "SUCCEEDED").length;
  const failedRuns = aiRuns.filter((run) => run.status === "FAILED").length;
  const fallbackRuns = aiRuns.filter((run) => run.fallbackCount > 0).length;
  const averageDurationMs = aiRuns.length
    ? Math.round(aiRuns.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / aiRuns.length)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Sistema"
        title="Backlog de IA"
        description="Aquí viven los incidentes y sugerencias que el asistente va acumulando por tema."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full"><Link href="/api/admin/assistant/health" target="_blank">Probar conexión</Link></Button>
            <RefreshPageButton label="Actualizar" />
          </div>
        }
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Corridas registradas</CardDescription>
            <CardTitle className="text-3xl">{aiRuns.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Corridas exitosas</CardDescription>
            <CardTitle className="text-3xl">{succeededRuns}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Corridas con fallback</CardDescription>
            <CardTitle className="text-3xl">{fallbackRuns}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Corridas fallidas</CardDescription>
            <CardTitle className="text-3xl">{failedRuns}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Duración media</CardDescription>
            <CardTitle className="text-3xl">{formatDurationMs(averageDurationMs)}</CardTitle>
          </CardHeader>
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
          <TabsTrigger value="uso-ia">Uso IA</TabsTrigger>
        </TabsList>
        <TabsContent value="incidentes" className="space-y-4">
          <ReportList reports={incidents} />
        </TabsContent>
        <TabsContent value="sugerencias" className="space-y-4">
          <ReportList reports={suggestions} />
        </TabsContent>
        <TabsContent value="uso-ia" className="space-y-4">
          <AiRunList runs={aiRuns} />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
import Link from "next/link";
