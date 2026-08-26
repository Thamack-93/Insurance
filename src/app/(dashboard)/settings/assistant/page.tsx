import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import { requireOrganizationRoleOrRedirect } from "@/lib/organization-context";
import { listAssistantReports } from "@/lib/assistant-reports";
import { getAssistantAiConnectionStatus, getAssistantAiOperationLabel, getAssistantAiRuntimeLimits } from "@/lib/assistant-ai";
import { getAssistantAiMonthlyUsageSummary, listAssistantAiRuns } from "@/lib/assistant-ai-runs";
import { getNoraAgentMode, getNoraAiMonthlySoftLimitUsd } from "@/lib/assistant-agent-config";
import { listGeneralKnowledgeSources, listInternalKnowledgeSources } from "@/lib/knowledge-base";
import { formatDate } from "@/lib/dates";
import { statusLabel } from "@/lib/status";
import { AssistantReportActionButtons } from "@/components/assistant/report-action-buttons";
import { Gauge, ShieldCheck } from "lucide-react";
import { KnowledgeBaseTester } from "@/components/settings/knowledge-base-tester";
import { KnowledgeSourceActivationButton } from "@/components/settings/knowledge-source-actions";
import {
  assistantAiStatusLabel,
  assistantAiTierLabel,
  assistantReportKindLabel,
  assistantReportStatusLabel,
} from "@/lib/ui-labels";
import {
  archiveAssistantReportAction,
  closeAssistantReportAction,
  deleteAssistantReportAction,
  reopenAssistantReportAction,
  activateKnowledgeSourceAction,
  archiveKnowledgeSourceAction,
  createKnowledgeSourceAction,
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

function validityLabel(source: { effectiveFrom: Date | null; effectiveTo: Date | null }) {
  const today = new Date();
  if (source.effectiveFrom && today < source.effectiveFrom) return "FUERA DE VIGENCIA";
  if (source.effectiveTo && today > source.effectiveTo) return "FUERA DE VIGENCIA";
  return null;
}

function integrityLabel(source: { manifestHash: string | null; integrityVersion: string | null; integrityVerifiedAt: Date | null }) {
  if (source.integrityVerifiedAt && (source.integrityVersion !== "CHUNK_MANIFEST_V1" || !/^[0-9a-f]{64}$/u.test(source.manifestHash ?? ""))) return "INTEGRIDAD INVÁLIDA";
  return null;
}

function getAiRunMetadata(run: Awaited<ReturnType<typeof listAssistantAiRuns>>[number], key: "executionProfile" | "stepCount" | "terminationReason") {
  const metadata = run.providerMetadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function isHistoricalAssistantIncident(
  report: Awaited<ReturnType<typeof listAssistantReports>>[number],
  activeModels: string[],
) {
  if (report.kind !== "INCIDENT") return false;
  const diagnosticModels = report.evidence
    .map((entry) => entry.diagnostic?.model)
    .filter((model): model is string => Boolean(model));
  return diagnosticModels.length > 0 && diagnosticModels.every((model) => !activeModels.includes(model));
}

function ReportList({
  reports,
  activeModels,
}: {
  reports: Awaited<ReturnType<typeof listAssistantReports>>;
  activeModels: string[];
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
                    {assistantReportStatusLabel(report.status)}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    v{report.version}
                  </Badge>
                  {isHistoricalAssistantIncident(report, activeModels) ? (
                    <Badge variant="outline" className="rounded-full">Histórico · configuración anterior</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="mt-1">
                  {report.themeLabel} · {assistantReportKindLabel(report.kind)} · {report.signalCount} señales
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
            {isHistoricalAssistantIncident(report, activeModels) ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Este incidente se conserva como auditoría, pero corresponde a un modelo que ya no está en la cadena activa de Nora.
              </p>
            ) : null}
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
                  {getAssistantAiOperationLabel(run.operation)}
                  <Badge variant={run.status === "SUCCEEDED" ? "default" : run.status === "FAILED" ? "destructive" : "outline"} className="rounded-full">
                    {assistantAiStatusLabel(run.status)}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    {assistantAiTierLabel(run.tier)}
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1">
                  {run.requestedModel} · {run.attemptCount} intentos · {run.fallbackCount} alternativa{run.fallbackCount === 1 ? "" : "s"}
                </CardDescription>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Total: {formatDurationMs(run.durationMs ?? 0)}</p>
                <p>{formatDate(new Date(run.createdAt))}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Modelo final</p>
                <p className="mt-1 font-medium">{run.finalModel ?? "Sin dato"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Costo Gateway / estimado</p>
                <p className="mt-1 font-medium">{formatCostUsd(run.estimatedCostUsd)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tokens</p>
                <p className="mt-1 font-medium">
                  {formatTokenCount(run.totalUsage?.totalTokens ?? run.usage?.totalTokens)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Texto {formatTokenCount(run.totalUsage?.textTokens ?? run.usage?.textTokens)} · Razonamiento {formatTokenCount(run.totalUsage?.reasoningTokens ?? run.usage?.reasoningTokens)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Caché</p>
                <p className="mt-1 font-medium">
                  {formatTokenCount(run.totalUsage?.cacheReadTokens ?? run.usage?.cacheReadTokens ?? run.totalUsage?.cachedInputTokens ?? run.usage?.cachedInputTokens)} leídos
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTokenCount(run.totalUsage?.cacheWriteTokens ?? run.usage?.cacheWriteTokens)} escritos
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
              <span>Perfil: {getAiRunMetadata(run, "executionProfile") ?? "sin dato"}</span>
              <span>Pasos: {getAiRunMetadata(run, "stepCount") ?? "sin dato"}</span>
              <span>Terminación: {getAiRunMetadata(run, "terminationReason") ?? "sin dato"}</span>
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
                        {assistantAiStatusLabel(attempt.status)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      <span>Nivel: {assistantAiTierLabel(attempt.tier)}</span>
                      <span>Modelo final: {attempt.finalModel ?? "sin dato"}</span>
                      <span>Motivo: {attempt.fallbackReason ?? "sin motivo"}</span>
                      <span>Duración: {formatDurationMs(attempt.durationMs ?? 0)}</span>
                      <span>Código: {attempt.code ?? "ok"}</span>
                      <span>Finalización: {attempt.finishReason ?? "sin dato"}</span>
                    </div>
                    {attempt.usage ? (
                      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span>In: {formatTokenCount(attempt.usage.inputTokens)}</span>
                        <span>Cache read: {formatTokenCount(attempt.usage.cacheReadTokens ?? attempt.usage.cachedInputTokens)}</span>
                        <span>Cache write: {formatTokenCount(attempt.usage.cacheWriteTokens)}</span>
                        <span>Texto: {formatTokenCount(attempt.usage.textTokens)}</span>
                        <span>Razonamiento: {formatTokenCount(attempt.usage.reasoningTokens)}</span>
                        <span>Out: {formatTokenCount(attempt.usage.outputTokens)}</span>
                        <span>Total: {formatTokenCount(attempt.usage.totalTokens)}</span>
                        <span>Costo: {formatCostUsd(attempt.usage.billedCostUsd ?? attempt.usage.estimatedCostUsd)}</span>
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
  const organizationContext = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const aiStatus = getAssistantAiConnectionStatus();
  const runtimeLimits = getAssistantAiRuntimeLimits();
  const [incidents, suggestions, monthlyUsage, knowledgeSources, generalKnowledgeSources] = await Promise.all([
    listAssistantReports({ organizationId: organizationContext.organizationId, kind: "INCIDENT", limit: 100 }),
    listAssistantReports({ organizationId: organizationContext.organizationId, kind: "SUGGESTION", limit: 100 }),
    getAssistantAiMonthlyUsageSummary(organizationContext.organizationId),
    listInternalKnowledgeSources(organizationContext.organizationId),
    listGeneralKnowledgeSources(),
  ]);
  const aiRuns = await listAssistantAiRuns({ organizationId: organizationContext.organizationId, limit: 50 });

  const activeModels = [aiStatus.model, ...aiStatus.fallbackModels];
  const openIncidents = incidents.filter((report) =>
    (report.status === "OPEN" || report.status === "COLLECTING") && !isHistoricalAssistantIncident(report, activeModels),
  ).length;
  const openSuggestions = suggestions.filter((report) => report.status === "OPEN" || report.status === "COLLECTING").length;
  const succeededRuns = aiRuns.filter((run) => run.status === "SUCCEEDED").length;
  const failedRuns = aiRuns.filter((run) => run.status === "FAILED").length;
  const averageDurationMs = aiRuns.length
    ? Math.round(aiRuns.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / aiRuns.length)
    : 0;
  const agentMode = getNoraAgentMode();
  const softLimitUsd = getNoraAiMonthlySoftLimitUsd();

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
                ? `La IA está lista para responder y generar mejoras con modelos alternativos: ${aiStatus.fallbackModels.join(", ")}.`
                : "La IA no está disponible todavía. Revisa credenciales o entorno."}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Llamadas este mes</CardDescription>
            <CardTitle className="text-3xl">{monthlyUsage.runCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Costo del mes</CardDescription>
            <CardTitle className="text-3xl">{formatCostUsd(monthlyUsage.costUsd)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">Límite interno: {formatCostUsd(softLimitUsd)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Entrada cacheada</CardDescription>
            <CardTitle className="text-3xl">{Math.round(monthlyUsage.cacheReadRatio * 100)}%</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {formatTokenCount(monthlyUsage.cacheReadTokens)} leídos · {formatTokenCount(monthlyUsage.cacheWriteTokens)} escritos · {monthlyUsage.cacheReadRuns} corridas con lectura · {monthlyUsage.cacheWriteRuns} con escritura
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Salida IA</CardDescription>
            <CardTitle className="text-3xl">{formatTokenCount(monthlyUsage.outputTokens)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {formatTokenCount(monthlyUsage.textTokens)} texto · {formatTokenCount(monthlyUsage.reasoningTokens)} razonamiento
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Modo Nora</CardDescription>
            <CardTitle className="text-3xl">{agentMode}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">Prompts: {monthlyUsage.promptVersions.join(", ") || "sin datos"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Corridas exitosas</CardDescription>
            <CardTitle className="text-3xl">{succeededRuns}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Fallbacks este mes</CardDescription>
            <CardTitle className="text-3xl">{monthlyUsage.fallbackRuns}</CardTitle>
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
          <p className="text-xs text-muted-foreground">
            Las lecturas continúan mientras el proveedor emita progreso. Watchdog de inactividad: {formatDurationMs(runtimeLimits.idleTimeoutMs)} · límite de emergencia: {formatDurationMs(runtimeLimits.emergencyTimeoutMs)}.
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Knowledge base de seguros</CardTitle>
          <CardDescription>
            Registra aquí fuentes internas como borradores. Solo las fuentes activas se recuperan; las preguntas contractuales nunca se responden con la guía general.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <form action={createKnowledgeSourceAction} className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium">Registrar fuente interna</p>
            <Input name="title" placeholder="Título del documento" required maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input name="insurerName" placeholder="Aseguradora" maxLength={160} />
              <Input name="product" placeholder="Producto" maxLength={120} />
              <Input name="version" placeholder="Versión" required maxLength={80} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="authority" placeholder="Autoridad o fuente" maxLength={120} />
              <Input name="sourceUrl" type="url" placeholder="URL de origen (https://…)" maxLength={500} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-muted-foreground">Revisada<input name="reviewedAt" type="date" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Vigente desde<input name="effectiveFrom" type="date" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Vigente hasta<input name="effectiveTo" type="date" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>
            </div>
            <Textarea name="content" placeholder="Pega únicamente texto operativo autorizado; no subas expedientes clínicos ni narrativa médica." required maxLength={100_000} className="min-h-40" />
            <Button type="submit" className="rounded-full">Guardar borrador</Button>
          </form>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Fuentes internas de esta organización</p>
              <Badge variant="outline" className="rounded-full">GENERAL: solo lectura global</Badge>
            </div>
            {knowledgeSources.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Todavía no hay fuentes internas.</p> : null}
            {knowledgeSources.map((source) => (
              <div key={source.id} className="rounded-2xl border border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{source.title}</p>
                    <p className="text-xs text-muted-foreground">v{source.version} · {source.insurerName ?? "Aseguradora no indicada"} · {source.product ?? "Producto no indicado"} · {source._count.chunks} fragmentos</p>
                    <p className="mt-1 text-xs text-muted-foreground">{source.authority ?? "Fuente no indicada"}{source.reviewedAt ? ` · revisada ${formatDate(source.reviewedAt)}` : ""} · vigencia {source.effectiveFrom ? formatDate(source.effectiveFrom, "yyyy-MM-dd") : "sin inicio"}–{source.effectiveTo ? formatDate(source.effectiveTo, "yyyy-MM-dd") : "sin fin"}{source.sourceUrl ? <a className="ml-1 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">origen</a> : null}</p>
                  </div>
                  <Badge variant={source.status === "ACTIVE" && source.integrityVerifiedAt ? "default" : source.status === "ARCHIVED" ? "outline" : "secondary"} className="rounded-full">{integrityLabel(source) ?? validityLabel(source) ?? (source.integrityVerifiedAt ? statusLabel(source.status) : `${statusLabel(source.status)} · integridad pendiente`)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {source.status !== "ACTIVE" && source.status !== "ARCHIVED" ? <KnowledgeSourceActivationButton action={activateKnowledgeSourceAction.bind(null, source.id)} title={source.title} version={source.version} chunkCount={source._count.chunks} effectiveFrom={source.effectiveFrom ? formatDate(source.effectiveFrom, "yyyy-MM-dd") : ""} effectiveTo={source.effectiveTo ? formatDate(source.effectiveTo, "yyyy-MM-dd") : ""} /> : null}
                  {source.status !== "ARCHIVED" ? <form action={archiveKnowledgeSourceAction.bind(null, source.id)}><Button type="submit" size="sm" variant="outline" className="rounded-full">Archivar</Button></form> : null}
                </div>
              </div>
            ))}
            <div className="mt-5 border-t border-border/70 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">Fuentes generales de plataforma</p>
                <Badge variant="outline" className="rounded-full">Solo lectura</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Estas guías son orientativas, globales y no pueden modificarse desde una organización.</p>
              <div className="mt-3 space-y-2">
                {generalKnowledgeSources.map((source) => (
                  <div key={source.id} className="rounded-xl border border-border/70 bg-muted/10 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{source.title}</p>
                        <p className="text-xs text-muted-foreground">v{source.version} · {source.product ?? "General"} · {source._count.chunks} fragmentos</p>
                        <p className="mt-1 text-xs text-muted-foreground">{source.authority ?? "Fuente no indicada"}{source.reviewedAt ? ` · revisada ${formatDate(source.reviewedAt)}` : ""} · vigencia {source.effectiveFrom ? formatDate(source.effectiveFrom, "yyyy-MM-dd") : "sin inicio"}–{source.effectiveTo ? formatDate(source.effectiveTo, "yyyy-MM-dd") : "sin fin"}{source.sourceUrl ? <a className="ml-1 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">origen</a> : null}</p>
                      </div>
                  <Badge variant={source.status === "ACTIVE" && source.integrityVerifiedAt ? "default" : source.status === "ARCHIVED" ? "outline" : "secondary"} className="rounded-full">{integrityLabel(source) ?? validityLabel(source) ?? (source.integrityVerifiedAt ? statusLabel(source.status) : `${statusLabel(source.status)} · integridad pendiente`)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
        <CardContent className="pt-0">
          <KnowledgeBaseTester sources={knowledgeSources.map((source) => ({ id: source.id, title: source.title, status: source.status, version: source.version }))} />
        </CardContent>
      </Card>

      <UrlTabs defaultValue="incidentes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="incidentes">Incidentes</TabsTrigger>
          <TabsTrigger value="sugerencias">Sugerencias</TabsTrigger>
          <TabsTrigger value="uso-ia">Uso IA</TabsTrigger>
        </TabsList>
        <TabsContent value="incidentes" className="space-y-4">
          <ReportList reports={incidents} activeModels={activeModels} />
        </TabsContent>
        <TabsContent value="sugerencias" className="space-y-4">
          <ReportList reports={suggestions} activeModels={activeModels} />
        </TabsContent>
        <TabsContent value="uso-ia" className="space-y-4">
          <AiRunList runs={aiRuns} />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
import Link from "next/link";
