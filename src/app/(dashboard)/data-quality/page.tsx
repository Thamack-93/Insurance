import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  AlertTriangle,
  CalendarCheck2,
  FileWarning,
  FolderKanban,
  ReceiptText,
  ShieldAlert,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyLedgerImportBatchAction, previewLedgerImportAction, runPaymentAuditAction, runVigencyAuditAction } from "./actions";
import {
  getClientDataQualityScores,
  getOperationalDataHealthSummary,
  getLedgerReviewIssues,
  getPolicyDataQualityScores,
  getReceiptReviewIssues,
  getRenewalReviewSuggestions,
} from "@/lib/data-quality";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { getLatestMaintenanceRun } from "@/lib/vigency-maintenance";
import { getUpcomingRenewals } from "@/lib/renewals";
import { RunVigencyAuditButton } from "@/components/data-quality/run-vigency-audit-button";
import { RunPaymentAuditButton } from "@/components/data-quality/run-payment-audit-button";
import { ReviewActionButtons } from "@/components/data-quality/review-action-buttons";
import { ClientResolutionActions, PolicyResolutionActions, RenewalResolutionActions } from "@/components/risk-resolution/resolution-actions";
import { PageRefreshTicker } from "@/components/risk-resolution/page-refresh-ticker";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import {
  approveLedgerIssue,
  approveReceiptReviewIssue,
  denyLedgerIssue,
  denyReceiptReviewIssue,
  bulkReceiptReviewIssuesAction,
  bulkRenewalSuggestionReviewsAction,
  bulkLedgerIssuesAction,
  reopenReceiptReviewIssue,
  reopenRenewalSuggestionReview,
  reopenLedgerIssue,
  suppressReceiptReviewIssue,
  suppressLedgerIssue,
} from "./actions";

function QualityBadge({ nivel }: { nivel: "Excelente" | "Bueno" | "Atención" | "Crítico" }) {
  const colors = {
    Excelente: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Bueno: "bg-blue-100 text-blue-700 border-blue-200",
    Atención: "bg-amber-100 text-amber-700 border-amber-200",
    Crítico: "bg-rose-100 text-rose-700 border-rose-200",
  };

  return (
    <Badge className={`${colors[nivel]} rounded-full`}>
      {nivel}
    </Badge>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-blue-500" : score >= 50 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium">{score}</span>
    </div>
  );
}

function formatGapDays(gapDays: number | null) {
  if (gapDays === null) return "—";
  if (gapDays === 0) return "mismo día";
  return `${gapDays} días`;
}

function receiptReviewReasonLabel(reason: string) {
  if (reason === "payment_after_due_date") return "Pago después del vencimiento";
  return reason;
}

export default async function DataQualityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const initialTab =
    params.tab === "salud" || params.tab === "vigencias" || params.tab === "pagos" || params.tab === "renovaciones" || params.tab === "ledger"
      ? params.tab
      : "salud";
  const previewBatchId = typeof params.ledgerBatch === "string" ? params.ledgerBatch : null;
  const db = getDb();
  const [
    clientScores,
    policyScores,
    operationalHealth,
    latestMaintenanceRun,
    latestPaymentMaintenanceRun,
    receiptReviewIssues,
    renewalReviewSuggestions,
    ledgerReviewIssues,
    renewalFollowUps,
  ] = await Promise.all([
    getClientDataQualityScores(),
    getPolicyDataQualityScores(),
    getOperationalDataHealthSummary(),
    getLatestMaintenanceRun("POLICY_VIGENCY_AUDIT"),
    getLatestMaintenanceRun("PAYMENT_RECONCILIATION_AUDIT"),
    getReceiptReviewIssues(),
    getRenewalReviewSuggestions(),
    getLedgerReviewIssues(),
    getUpcomingRenewals(30),
  ]);
  const previewBatch = previewBatchId
      ? await db.ledgerImportBatch.findUnique({
        where: { id: previewBatchId },
        include: {
          rows: {
            orderBy: [{ rowNumber: "asc" }],
            take: 15,
          },
          issues: {
            include: {
              row: {
                select: { rowNumber: true, sourceType: true, sourceKey: true },
              },
            },
            orderBy: [{ createdAt: "desc" }],
            take: 20,
          },
        },
      })
    : null;
  const previewSummary = (() => {
    if (!previewBatch?.summaryJson) return null;
    try {
      return JSON.parse(previewBatch.summaryJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const previewRowCounts = previewBatch
    ? await db.ledgerImportRow.groupBy({
        by: ["status"],
        where: { batchId: previewBatch.id },
        _count: { status: true },
      })
    : [];
  const readyRowCount = previewRowCounts.find((row) => row.status === "READY")?._count.status ?? 0;
  const reviewRowCount = previewRowCounts.find((row) => row.status === "REVIEW")?._count.status ?? 0;

  const latestAuditSummary = (() => {
    if (!latestMaintenanceRun?.summaryJson) return null;
    try {
      return JSON.parse(latestMaintenanceRun.summaryJson) as {
        familiesReviewed?: number;
        familiesLinked?: number;
        policiesUpdated?: number;
        policySuggestionsUpserted?: number;
        receiptsReviewed?: number;
        receiptsRelinked?: number;
        receiptsReconciled?: number;
        paymentsReviewed?: number;
        paymentsRelinked?: number;
        receiptIssuesOpened?: number;
        receiptIssuesResolved?: number;
        multiYearPoliciesFlagged?: number;
        overlappingFamilies?: number;
        paymentFrequenciesNormalized?: number;
        paymentFrequencyReviewCandidates?: number;
        paymentFrequencyReviewSample?: Array<{
          policyId: string;
          policyNumber: string;
          currentFrequency: string;
          receiptCount: number;
          reason: string;
        }>;
      };
    } catch {
      return null;
    }
  })();

  const latestPaymentAuditSummary = (() => {
    if (!latestPaymentMaintenanceRun?.summaryJson) return null;
    try {
      return JSON.parse(latestPaymentMaintenanceRun.summaryJson) as {
        familiesReviewed?: number;
        familiesWithMultiplePolicies?: number;
        receiptsScanned?: number;
        receiptsUpdated?: number;
        receiptsFlaggedForReview?: number;
        receiptIssuesOpened?: number;
        receiptIssuesResolved?: number;
        familyKeysSample?: string[];
        reviewReceipts?: Array<{
          receiptId: string;
          receiptNumber: string;
          familyKey: string;
          policyId: string;
          policyNumber: string;
          clientName: string;
          insurerName: string;
          amount: number;
          paidAmount: number;
          reasons: string[];
        }>;
      };
    } catch {
      return null;
    }
  })();

  const avgClientScore = Math.round(
    clientScores.reduce((sum, c) => sum + c.score, 0) / (clientScores.length || 1)
  );
  const avgPolicyScore = Math.round(
    policyScores.reduce((sum, p) => sum + p.score, 0) / (policyScores.length || 1)
  );

  const clientMissingData = clientScores.filter((c) => c.issues.length > 0);
  const clientAttention = clientScores.filter((c) => c.nivel === "Atención").length;
  const policyCritical = policyScores.filter((p) => p.score < 50).length;
  const policyAttention = policyScores.filter((p) => p.score >= 50 && p.score < 75).length;
  const renewalFollowUpByClient = renewalFollowUps.reduce((acc, renewal) => {
    const current = acc.get(renewal.clientId) ?? {
      clienteId: renewal.clientId,
      cliente: renewal.clientName,
      overduePolicies: 0,
      followUpPolicies: 0,
      nextRenewalDate: renewal.endDate,
      items: [],
    };

    if (renewal.daysUntilRenewal <= 0) {
      current.overduePolicies += 1;
    } else {
      current.followUpPolicies += 1;
    }

    current.nextRenewalDate =
      current.nextRenewalDate === null || renewal.endDate < current.nextRenewalDate
        ? renewal.endDate
        : current.nextRenewalDate;

    current.items.push(renewal);
    acc.set(renewal.clientId, current);
    return acc;
  }, new Map<string, {
    clienteId: string;
    cliente: string;
    overduePolicies: number;
    followUpPolicies: number;
    nextRenewalDate: Date | null;
    items: typeof renewalFollowUps;
  }>());
  const renewalCriticalClients = [...renewalFollowUpByClient.values()]
    .filter((client) => client.overduePolicies > 0)
    .sort((a, b) => b.overduePolicies - a.overduePolicies || a.cliente.localeCompare(b.cliente));
  const renewalFollowUpClients = [...renewalFollowUpByClient.values()]
    .filter((client) => client.overduePolicies === 0)
    .sort((a, b) => b.followUpPolicies - a.followUpPolicies || a.cliente.localeCompare(b.cliente));
  const renewalCriticalPolicies = renewalCriticalClients.reduce((sum, client) => sum + client.overduePolicies, 0);
  const renewalFollowUpPolicies = renewalFollowUpClients.reduce((sum, client) => sum + client.followUpPolicies, 0);
  const renewalRows = [
    ...renewalCriticalClients.map((client) => ({ ...client, statusLabel: "Crítica" as const })),
    ...renewalFollowUpClients.map((client) => ({ ...client, statusLabel: "Seguimiento" as const })),
  ];

  const allIssues = [
    ...clientScores.flatMap((c) => c.issues.map((i) => ({ ...i, entity: c.cliente, entityId: c.clienteId, type: "cliente" as const }))),
    ...policyScores.flatMap((p) => p.issues.map((i) => ({ ...i, entity: p.poliza, entityId: p.polizaId, type: "poliza" as const }))),
  ];

  const issueCounts = allIssues.reduce((acc, issue) => {
    acc[issue.code] = (acc[issue.code] || { count: 0, label: issue.etiqueta });
    acc[issue.code].count++;
    return acc;
  }, {} as Record<string, { count: number; label: string }>);

  const topIssues = Object.entries(issueCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  const paymentAfterDueDateIssues = receiptReviewIssues.filter((issue) => issue.reason === "payment_after_due_date");
  const openPaymentAfterDueDateIssues = paymentAfterDueDateIssues.filter((issue) => issue.status === "OPEN");
  const closedPaymentAfterDueDateIssues = paymentAfterDueDateIssues.filter((issue) => issue.status !== "OPEN");
  const paymentWithin30Days = openPaymentAfterDueDateIssues.filter((issue) => issue.gapDays !== null && issue.gapDays <= 30).length;
  const paymentOver30Days = openPaymentAfterDueDateIssues.filter((issue) => issue.gapDays !== null && issue.gapDays > 30).length;
  const paymentMaxGap = openPaymentAfterDueDateIssues.reduce((max, issue) => Math.max(max, issue.gapDays ?? 0), 0);
  const receiptIssuesByYear = openPaymentAfterDueDateIssues.reduce((acc, issue) => {
    const year = issue.dueDate.getUTCFullYear();
    acc[year] = (acc[year] ?? 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const openRenewalSuggestions = renewalReviewSuggestions.filter((suggestion) => suggestion.status === "PENDING");
  const closedRenewalSuggestions = renewalReviewSuggestions.filter((suggestion) => suggestion.status !== "PENDING");
  const openLedgerIssues = ledgerReviewIssues.filter((issue) => issue.status === "OPEN");
  const closedLedgerIssues = ledgerReviewIssues.filter((issue) => issue.status !== "OPEN");

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageRefreshTicker />
        <PageHeader
          eyebrow="Calidad"
          title="Data Quality"
          description="Cada categoría abre su propia revisión: salud operativa, vigencias, pagos, renovaciones y ledger."
          actions={
            <>
              <RefreshPageButton />
              <Button asChild className="rounded-full">
                <Link href="/risks">
                  Ver riesgos
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <UrlTabs defaultValue={initialTab} className="space-y-6">
          <TabsList className="rounded-full bg-card/70 p-1">
            <TabsTrigger value="salud" className="rounded-full px-4">
              Salud
            </TabsTrigger>
            <TabsTrigger value="vigencias" className="rounded-full px-4">
              Vigencias
            </TabsTrigger>
            <TabsTrigger value="pagos" className="rounded-full px-4">
              Pagos
            </TabsTrigger>
            <TabsTrigger value="renovaciones" className="rounded-full px-4">
              Renovaciones
            </TabsTrigger>
            <TabsTrigger value="ledger" className="rounded-full px-4">
              Ledger
            </TabsTrigger>
          </TabsList>

          <TabsContent value="salud" className="space-y-6">
            <SectionCard
              title="Salud operativa"
              description="Guardrails para detectar datos invisibles, usuarios demo y residuos del importador."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard
                  title="Clientes sin dueño"
                  value={operationalHealth.clientsWithoutPortfolioOwner}
                  description="Debe permanecer en cero."
                  icon={Users}
                  tone={operationalHealth.clientsWithoutPortfolioOwner === 0 ? "emerald" : "rose"}
                />
                <MetricCard
                  title="Usuarios demo"
                  value={operationalHealth.activeDemoUsers}
                  description={operationalHealth.brokerDemoPresent ? "Broker Demo sigue presente." : "Broker Demo ausente."}
                  icon={ShieldAlert}
                  tone={operationalHealth.brokerDemoPresent ? "rose" : "amber"}
                />
                <MetricCard
                  title="Búsqueda global"
                  value={operationalHealth.globalSearchOk ? "OK" : "Falla"}
                  description={`${operationalHealth.globalSearchResultCount} resultados para 199658.`}
                  icon={BadgeCheck}
                  tone={operationalHealth.globalSearchOk ? "emerald" : "rose"}
                />
                <MetricCard
                  title="Vencidos visibles"
                  value={operationalHealth.overdueOpenReceiptsOwned}
                  description={`${operationalHealth.overdueOpenReceipts} recibos vencidos abiertos.`}
                  icon={AlertTriangle}
                  tone="rose"
                />
                <MetricCard
                  title="Asegurados sueltos"
                  value={operationalHealth.insuredOnlyClientsWithoutPolicies}
                  description="Clientes ASEGURADO: sin pólizas."
                  icon={FileWarning}
                  tone={operationalHealth.insuredOnlyClientsWithoutPolicies === 0 ? "emerald" : "amber"}
                />
              </div>
            </SectionCard>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Score clientes"
                value={avgClientScore}
                description={`Promedio de ${clientScores.length} clientes evaluados`}
                icon={Users}
                tone={avgClientScore >= 75 ? "emerald" : avgClientScore >= 50 ? "amber" : "rose"}
              />
              <MetricCard
                title="Score pólizas"
                value={avgPolicyScore}
                description={`Promedio de ${policyScores.length} pólizas evaluadas`}
                icon={FolderKanban}
                tone={avgPolicyScore >= 75 ? "emerald" : avgPolicyScore >= 50 ? "amber" : "rose"}
              />
              <MetricCard
                title="Críticos"
                value={policyCritical + renewalCriticalPolicies}
                description={`${policyCritical} pólizas + ${renewalCriticalPolicies} renovaciones`}
                icon={ShieldAlert}
                tone="rose"
              />
              <MetricCard
                title="Atención"
                value={clientAttention + policyAttention + renewalFollowUpPolicies}
                description={`${clientAttention} clientes + ${policyAttention} pólizas + ${renewalFollowUpPolicies} seguimientos`}
                icon={AlertTriangle}
                tone="amber"
              />
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <SectionCard title="Calidad por cliente" description="Ordenados por score ascendente (peores primero).">
                {clientScores.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No hay clientes para evaluar.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/70">
                        <TableHead>Cliente</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Nivel</TableHead>
                        <TableHead className="text-right">Pólizas</TableHead>
                        <TableHead className="text-right">Prima</TableHead>
                        <TableHead className="text-right">Resolver</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientScores.slice(0, 10).map((client) => (
                        <TableRow key={client.clienteId}>
                          <TableCell>
                            <Link href={`/clients/${client.clienteId}`} className="font-medium text-foreground hover:text-primary">
                              {client.cliente}
                            </Link>
                            {client.issues.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{client.issues.length} problema(s)</p>}
                          </TableCell>
                          <TableCell>
                            <ScoreBar score={client.score} />
                          </TableCell>
                          <TableCell>
                            <QualityBadge nivel={client.nivel} />
                          </TableCell>
                          <TableCell className="text-right">{client.polizasActivas}/{client.totalPolizas}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(client.ingresosEstimados)}</TableCell>
                          <TableCell className="text-right">
                            {client.issues.length > 0 ? (
                              <ClientResolutionActions
                                clientId={client.clienteId}
                                clientName={client.cliente}
                                email={client.email}
                                phone={client.phone}
                                secondaryPhone={client.secondaryPhone}
                                address={client.address}
                                rfc={client.rfc}
                                preferredContactMethod={client.preferredContactMethod}
                                notes={null}
                                issueCodes={client.issues.map((issue) => issue.code)}
                                allowClose={true}
                                allowEdit={!(client.issues.length === 1 && client.issues[0].code === "CLIENT_WITHOUT_POLICY")}
                                consolidateLabel="Consolidar"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin acción</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>

              <SectionCard title="Calidad por póliza" description="Ordenados por score ascendente (peores primero).">
                {policyScores.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No hay pólizas para evaluar.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/70">
                        <TableHead>Póliza</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Nivel</TableHead>
                        <TableHead>Problemas</TableHead>
                        <TableHead className="text-right">Resolver</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policyScores.slice(0, 10).map((policy) => (
                        <TableRow key={policy.polizaId}>
                          <TableCell>
                            <Link href={`/policies/${policy.polizaId}`} className="font-medium text-foreground hover:text-primary">
                              {policy.poliza}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">{policy.cliente}</p>
                          </TableCell>
                          <TableCell>
                            <ScoreBar score={policy.score} />
                          </TableCell>
                          <TableCell>
                            <QualityBadge nivel={policy.nivel} />
                          </TableCell>
                          <TableCell>
                            {policy.issues.length === 0 ? (
                              <span className="text-xs text-muted-foreground">Sin problemas</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {policy.issues.slice(0, 2).map((issue) => (
                                <Badge key={issue.code} variant="outline" className="text-xs">
                                  {issue.etiqueta}
                                  </Badge>
                                ))}
                              {policy.issues.length > 2 && <Badge variant="outline" className="text-xs">+{policy.issues.length - 2}</Badge>}
                            </div>
                          )}
                          </TableCell>
                          <TableCell className="text-right">
                            {policy.issues.length > 0 ? (
                              <PolicyResolutionActions
                                policyId={policy.polizaId}
                                policyNumber={policy.poliza}
                                clientName={policy.cliente}
                                insurerName={policy.aseguradora}
                                insuredObject={policy.insuredObject}
                                premiumAmount={policy.premiumAmount}
                                paymentFrequency={policy.paymentFrequency}
                                status={policy.status}
                                notes={policy.notes}
                                issueCodes={policy.issues.map((issue) => issue.code)}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin acción</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </section>

            <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
              <SectionCard title="Problemas más comunes" description="Frecuencia de hallazgos de calidad.">
                {topIssues.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No hay problemas detectados. ¡Excelente trabajo!</div>
                ) : (
                  <div className="divide-y divide-stone-200/80">
                    {topIssues.map(([code, data]) => (
                      <div key={code} className="flex items-center justify-between gap-4 px-4 py-4">
                        <div className="flex items-center gap-3">
                          <FileWarning className="size-4 text-amber-500" />
                          <span className="text-sm font-medium">{data.label}</span>
                        </div>
                        <Badge variant="outline">{data.count} casos</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <div className="grid gap-6">
                <SectionCard
                  title="Clientes con datos faltantes"
                  description="No se marcan como críticos; solo quedan en seguimiento mientras no se capture información."
                >
                  {clientMissingData.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <BadgeCheck className="size-5 text-emerald-500" />
                        No hay clientes con datos faltantes.
                      </div>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50/70">
                          <TableHead>Cliente</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Problemas</TableHead>
                          <TableHead>Acción sugerida</TableHead>
                          <TableHead className="text-right">Resolver</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientMissingData.slice(0, 8).map((client) => (
                          <TableRow key={client.clienteId}>
                            <TableCell>
                              <Link href={`/clients/${client.clienteId}`} className="font-medium text-foreground hover:text-primary">
                                {client.cliente}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                Score: {client.score} · Completitud: {client.completitud}%
                              </p>
                            </TableCell>
                            <TableCell>
                              <QualityBadge nivel={client.nivel} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {client.issues.slice(0, 3).map((issue) => (
                                  <span key={issue.code} className="text-xs text-muted-foreground">
                                    • {issue.etiqueta}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button asChild size="sm" variant="outline" className="rounded-full">
                                <Link href={`/clients/${client.clienteId}`}>Ver cliente</Link>
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <ClientResolutionActions
                                clientId={client.clienteId}
                                clientName={client.cliente}
                                email={client.email}
                                phone={client.phone}
                                secondaryPhone={client.secondaryPhone}
                                address={client.address}
                                rfc={client.rfc}
                                preferredContactMethod={client.preferredContactMethod}
                                notes={null}
                                issueCodes={client.issues.map((issue) => issue.code)}
                                allowClose={true}
                                allowEdit={!(client.issues.length === 1 && client.issues[0].code === "CLIENT_WITHOUT_POLICY")}
                                consolidateLabel="Consolidar"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>

                <SectionCard
                  title="Clientes con renovación / seguimiento real"
                  description="Solo pólizas activas que sí requieren contacto o acción."
                >
                  {renewalRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <BadgeCheck className="size-5 text-emerald-500" />
                        No hay renovaciones activas que requieran seguimiento.
                      </div>
                    </div>
                  ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/70">
                        <TableHead>Cliente</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Renovaciones</TableHead>
                        <TableHead>Próxima vigencia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renewalRows.slice(0, 10).map((client) => (
                          <TableRow key={client.clienteId}>
                            <TableCell>
                              <Link href={`/clients/${client.clienteId}`} className="font-medium text-foreground hover:text-primary">
                                {client.cliente}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {client.overduePolicies > 0
                                  ? `${client.overduePolicies} vencida(s)`
                                  : `${client.followUpPolicies} seguimiento(s)`}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={client.statusLabel === "Crítica" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                                {client.statusLabel}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">{client.overduePolicies + client.followUpPolicies}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {client.nextRenewalDate ? formatDate(client.nextRenewalDate) : "—"}
                              </span>
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  )}
                </SectionCard>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="vigencias" className="space-y-6">
            <SectionCard
              title="Auditoría de vigencias"
              description="Revisa familias de pólizas, enlaza renovaciones y reconcilia recibos con pagos reales."
              action={<RunVigencyAuditButton runVigencyAudit={runVigencyAuditAction} />}
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Última corrida</p>
                  <p className="mt-1 text-sm font-medium">
                    {latestMaintenanceRun ? latestMaintenanceRun.startedAt.toLocaleString("es-MX") : "Sin auditorías"}
                  </p>
                  <p className="text-xs text-muted-foreground">{latestMaintenanceRun?.status ?? "Ningún run registrado todavía"}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Familias revisadas</p>
                  <p className="mt-1 text-2xl font-semibold">{latestAuditSummary?.familiesReviewed ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Recibos reconciliados</p>
                  <p className="mt-1 text-2xl font-semibold">{latestAuditSummary?.receiptsReconciled ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Issues abiertos</p>
                  <p className="mt-1 text-2xl font-semibold">{latestAuditSummary?.receiptIssuesOpened ?? 0}</p>
                </div>
              </div>
              {latestAuditSummary ? (
                <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                  <div>Vigencias enlazadas: {latestAuditSummary.familiesLinked ?? 0}</div>
                  <div>Pólizas actualizadas: {latestAuditSummary.policiesUpdated ?? 0}</div>
                  <div>Sugerencias creadas: {latestAuditSummary.policySuggestionsUpserted ?? 0}</div>
                  <div>Familias con solapamiento: {latestAuditSummary.overlappingFamilies ?? 0}</div>
                  <div>Pagos revisados: {latestAuditSummary.paymentsReviewed ?? 0}</div>
                  <div>Pagos vinculados: {latestAuditSummary.paymentsRelinked ?? 0}</div>
                  <div>Frecuencias normalizadas: {latestAuditSummary.paymentFrequenciesNormalized ?? 0}</div>
                  <div>Candidatos en revisión: {latestAuditSummary.paymentFrequencyReviewCandidates ?? 0}</div>
                </div>
              ) : null}
              {latestAuditSummary?.paymentFrequencyReviewSample?.length ? (
                <div className="mt-5 overflow-hidden rounded-2xl border border-stone-200/80">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/70">
                        <TableHead>Póliza</TableHead>
                        <TableHead>Frecuencia</TableHead>
                        <TableHead className="text-right">Recibos</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestAuditSummary.paymentFrequencyReviewSample.map((candidate) => (
                        <TableRow key={candidate.policyId}>
                          <TableCell>
                            <Link href={`/policies/${candidate.policyId}`} className="font-medium text-foreground hover:text-primary">
                              {candidate.policyNumber}
                            </Link>
                          </TableCell>
                          <TableCell>{candidate.currentFrequency}</TableCell>
                          <TableCell className="text-right">{candidate.receiptCount}</TableCell>
                          <TableCell className="max-w-md text-xs text-muted-foreground">{candidate.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </SectionCard>
          </TabsContent>

          <TabsContent value="pagos" className="space-y-6">
            <SectionCard
              title="Auditoría de pagos"
              description="Recalcula el estado visible de los recibos a partir de los pagos reales y deja en revisión los casos ambiguos."
              action={
                <div className="flex flex-wrap gap-2">
                  <RunPaymentAuditButton runPaymentAudit={runPaymentAuditAction} />
                  <Button asChild variant="outline" className="rounded-full bg-card/70">
                    <Link href="/receipts?tab=revision">Ver revisión</Link>
                  </Button>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Última corrida</p>
                  <p className="mt-1 text-sm font-medium">
                    {latestPaymentMaintenanceRun ? latestPaymentMaintenanceRun.startedAt.toLocaleString("es-MX") : "Sin auditorías"}
                  </p>
                  <p className="text-xs text-muted-foreground">{latestPaymentMaintenanceRun?.status ?? "Ningún run registrado todavía"}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Recibos revisados</p>
                  <p className="mt-1 text-2xl font-semibold">{latestPaymentAuditSummary?.receiptsScanned ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Recibos actualizados</p>
                  <p className="mt-1 text-2xl font-semibold">{latestPaymentAuditSummary?.receiptsUpdated ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Casos en revisión</p>
                  <p className="mt-1 text-2xl font-semibold">{latestPaymentAuditSummary?.receiptsFlaggedForReview ?? 0}</p>
                </div>
              </div>
              {latestPaymentAuditSummary ? (
                <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                  <div>Familias revisadas: {latestPaymentAuditSummary.familiesReviewed ?? 0}</div>
                  <div>Familias con múltiples pólizas: {latestPaymentAuditSummary.familiesWithMultiplePolicies ?? 0}</div>
                  <div>Issues abiertos: {latestPaymentAuditSummary.receiptIssuesOpened ?? 0}</div>
                  <div>Issues resueltos: {latestPaymentAuditSummary.receiptIssuesResolved ?? 0}</div>
                </div>
              ) : null}
              {latestPaymentAuditSummary?.reviewReceipts?.length ? (
                <div className="mt-5 overflow-hidden rounded-2xl border border-stone-200/80">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/70">
                        <TableHead>Recibo</TableHead>
                        <TableHead>Póliza</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead className="text-right">Recibo</TableHead>
                        <TableHead className="text-right">Pagado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestPaymentAuditSummary.reviewReceipts.slice(0, 8).map((issue) => (
                        <TableRow key={issue.receiptId}>
                          <TableCell>
                            <Link href={`/receipts/${issue.receiptId}`} className="font-medium text-foreground hover:text-primary">
                              {issue.receiptNumber}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link href={`/policies/${issue.policyId}`} className="hover:text-primary">
                              {issue.policyNumber}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p>{issue.clientName}</p>
                              <p className="text-xs text-muted-foreground">{issue.insurerName}</p>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">{issue.reasons.join(", ")}</TableCell>
                          <TableCell className="text-right">{formatCurrency(issue.amount, "MXN")}</TableCell>
                          <TableCell className="text-right">{formatCurrency(issue.paidAmount, "MXN")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="payment_after_due_date"
              description="Estos son los 28 casos revisados: todos requieren validación porque el pago quedó después del vencimiento."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Casos</p>
                  <p className="mt-1 text-2xl font-semibold">{openPaymentAfterDueDateIssues.length}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Dentro de 30 días</p>
                  <p className="mt-1 text-2xl font-semibold">{paymentWithin30Days}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Más de 30 días</p>
                  <p className="mt-1 text-2xl font-semibold">{paymentOver30Days}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Máxima brecha</p>
                  <p className="mt-1 text-2xl font-semibold">{formatGapDays(paymentMaxGap)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                <div>2023: {receiptIssuesByYear[2023] ?? 0}</div>
                <div>2024: {receiptIssuesByYear[2024] ?? 0}</div>
                <div>2025: {receiptIssuesByYear[2025] ?? 0}</div>
              </div>
              {openPaymentAfterDueDateIssues.length === 0 ? (
                <div className="p-4">
                  <ReceiptText className="mb-3 size-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No hay casos `payment_after_due_date` abiertos.</p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <form action={bulkReceiptReviewIssuesAction} className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead className="w-10">
                              <span className="sr-only">Seleccionar</span>
                            </TableHead>
                            <TableHead>Recibo</TableHead>
                            <TableHead>Póliza</TableHead>
                            <TableHead>Vencimiento</TableHead>
                            <TableHead>Pago</TableHead>
                            <TableHead className="text-right">Brecha</TableHead>
                            <TableHead className="text-right">Monto</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openPaymentAfterDueDateIssues.map((issue) => (
                            <TableRow key={issue.issueId}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  name="issueIds"
                                  value={issue.issueId}
                                  className="size-4 rounded border-border text-primary"
                                />
                              </TableCell>
                              <TableCell>
                                <Link href={`/receipts/${issue.receiptId}`} className="font-medium text-foreground hover:text-primary">
                                  {issue.receiptNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Link href={`/policies/${issue.policyId}`} className="hover:text-primary">
                                  {issue.policyNumber}
                                </Link>
                                <p className="text-xs text-muted-foreground">{issue.clientName}</p>
                              </TableCell>
                              <TableCell>{formatDate(issue.dueDate)}</TableCell>
                              <TableCell>{issue.paidDate ? formatDate(issue.paidDate) : "—"}</TableCell>
                              <TableCell className="text-right font-medium">{formatGapDays(issue.gapDays)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(issue.amount, issue.currency)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {receiptReviewReasonLabel(issue.reason)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <ReviewActionButtons
                                  id={issue.issueId}
                                  modifyHref={`/receipts/${issue.receiptId}/edit`}
                                  approveAction={approveReceiptReviewIssue}
                                  denyAction={denyReceiptReviewIssue}
                                  suppressAction={suppressReceiptReviewIssue}
                                  className="flex flex-wrap items-center justify-end gap-2"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-sm text-muted-foreground">
                        Selecciona filas para resolverlas en lote. También puedes dejar la fila individual con aprobar, denegar, suprimir o reabrir.
                      </p>
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button type="submit" name="operation" value="APPROVE" className="rounded-full">
                          Aprobar selección
                        </Button>
                        <Button type="submit" name="operation" value="DENY" variant="outline" className="rounded-full">
                          Denegar selección
                        </Button>
                        <Button type="submit" name="operation" value="SUPPRESS" variant="outline" className="rounded-full">
                          Suprimir selección
                        </Button>
                        <Button type="submit" name="operation" value="MERGE" variant="outline" className="rounded-full">
                          Fusionar selección
                        </Button>
                        <Button type="submit" name="operation" value="REOPEN" variant="ghost" className="rounded-full">
                          Reabrir selección
                        </Button>
                      </div>
                    </div>
                  </form>
                  {closedPaymentAfterDueDateIssues.length ? (
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <div className="border-b border-stone-200/80 bg-stone-50/70 px-4 py-3">
                        <p className="text-sm font-semibold">Historial reciente</p>
                        <p className="text-xs text-muted-foreground">Casos resueltos, descartados, suprimidos o fusionados.</p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead>Recibo</TableHead>
                            <TableHead>Póliza</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Salida</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {closedPaymentAfterDueDateIssues.slice(0, 10).map((issue) => (
                            <TableRow key={issue.issueId}>
                              <TableCell>
                                <Link href={`/receipts/${issue.receiptId}`} className="font-medium hover:text-primary">
                                  {issue.receiptNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Link href={`/policies/${issue.policyId}`} className="hover:text-primary">
                                  {issue.policyNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {issue.dispositionLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-md text-xs text-muted-foreground">
                                {issue.resolutionNote ?? issue.reason}
                              </TableCell>
                              <TableCell className="text-right">
                                <ReviewActionButtons
                                  id={issue.issueId}
                                  modifyHref={`/receipts/${issue.receiptId}/edit`}
                                  reopenAction={reopenReceiptReviewIssue}
                                  className="flex flex-wrap items-center justify-end gap-2"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="renovaciones" className="space-y-6">
            <SectionCard
              title="Renovaciones"
              description="Aquí puedes revisar qué está pendiente, qué ya se cerró y qué sigue en contexto para aprobación."
              action={
                <Button asChild className="rounded-full">
                  <Link href="/renewals">
                    Abrir renovaciones
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              }
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendientes</p>
                  <p className="mt-1 text-2xl font-semibold">{openRenewalSuggestions.length}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Declinadas</p>
                  <p className="mt-1 text-2xl font-semibold">{closedRenewalSuggestions.length}</p>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total revisadas</p>
                  <p className="mt-1 text-2xl font-semibold">{renewalReviewSuggestions.length}</p>
                </div>
              </div>
              {openRenewalSuggestions.length === 0 ? (
                <div className="p-4">
                  <CalendarCheck2 className="mb-3 size-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No hay sugerencias de renovación para revisar.</p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <form action={bulkRenewalSuggestionReviewsAction} className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead className="w-10">
                              <span className="sr-only">Seleccionar</span>
                            </TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Póliza origen</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Aseguradora</TableHead>
                            <TableHead>Póliza destino</TableHead>
                            <TableHead>Nota</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openRenewalSuggestions.slice(0, 20).map((suggestion) => (
                            <TableRow key={suggestion.suggestionId}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  name="issueIds"
                                  value={suggestion.suggestionId}
                                  className="size-4 rounded border-border text-primary"
                                />
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {suggestion.dispositionLabel}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Link href={`/policies/${suggestion.sourcePolicyId}`} className="font-medium hover:text-primary">
                                  {suggestion.sourcePolicyNumber}
                                </Link>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(suggestion.sourceStartDate)} → {formatDate(suggestion.sourceEndDate)}
                                </p>
                              </TableCell>
                              <TableCell>{suggestion.clientName}</TableCell>
                              <TableCell>{suggestion.insurerName}</TableCell>
                              <TableCell>
                                {suggestion.targetPolicyId ? (
                                  <Link href={`/policies/${suggestion.targetPolicyId}`} className="hover:text-primary">
                                    {suggestion.targetPolicyNumber}
                                  </Link>
                                ) : (
                                  "Pendiente"
                                )}
                              </TableCell>
                              <TableCell className="max-w-md text-xs text-muted-foreground">
                                {suggestion.reason ?? suggestion.resolutionNote ?? "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <RenewalResolutionActions
                                  mode="suggestion"
                                  suggestionId={suggestion.suggestionId}
                                  sourcePolicyId={suggestion.sourcePolicyId}
                                  sourcePolicyNumber={suggestion.sourcePolicyNumber}
                                  clientName={suggestion.clientName}
                                  insurerName={suggestion.insurerName}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-sm text-muted-foreground">
                        Marca varias sugerencias para aprobarlas, descartarlas, suprimirlas o fusionarlas como un solo caso maestro.
                      </p>
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button type="submit" name="operation" value="APPROVE" className="rounded-full">
                          Aprobar selección
                        </Button>
                        <Button type="submit" name="operation" value="DENY" variant="outline" className="rounded-full">
                          Denegar selección
                        </Button>
                        <Button type="submit" name="operation" value="SUPPRESS" variant="outline" className="rounded-full">
                          Suprimir selección
                        </Button>
                        <Button type="submit" name="operation" value="MERGE" variant="outline" className="rounded-full">
                          Fusionar selección
                        </Button>
                        <Button type="submit" name="operation" value="REOPEN" variant="ghost" className="rounded-full">
                          Reabrir selección
                        </Button>
                      </div>
                    </div>
                  </form>
                  {closedRenewalSuggestions.length ? (
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <div className="border-b border-stone-200/80 bg-stone-50/70 px-4 py-3">
                        <p className="text-sm font-semibold">Historial reciente</p>
                        <p className="text-xs text-muted-foreground">Sugerencias resueltas, descartadas, suprimidas o fusionadas.</p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead>Estado</TableHead>
                            <TableHead>Póliza origen</TableHead>
                            <TableHead>Póliza destino</TableHead>
                            <TableHead>Salida</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {closedRenewalSuggestions.slice(0, 10).map((suggestion) => (
                            <TableRow key={suggestion.suggestionId}>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {suggestion.dispositionLabel}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Link href={`/policies/${suggestion.sourcePolicyId}`} className="font-medium hover:text-primary">
                                  {suggestion.sourcePolicyNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                {suggestion.targetPolicyId ? (
                                  <Link href={`/policies/${suggestion.targetPolicyId}`} className="hover:text-primary">
                                    {suggestion.targetPolicyNumber}
                                  </Link>
                                ) : (
                                  "Pendiente"
                                )}
                              </TableCell>
                              <TableCell className="max-w-md text-xs text-muted-foreground">
                                {suggestion.resolutionNote ?? suggestion.reason ?? "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <ReviewActionButtons
                                  id={suggestion.suggestionId}
                                  modifyHref={`/policies/${suggestion.sourcePolicyId}/edit`}
                                  reopenAction={reopenRenewalSuggestionReview}
                                  className="flex flex-wrap items-center justify-end gap-2"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="ledger" className="space-y-6">
            <SectionCard
              title="Preview de importación de ledger"
              description="Carga el CSV de pólizas y el XLS de pagos para revisar vigencias faltantes, pagos ambiguos y casos de revisión antes de aplicar cambios."
            >
              <form action={previewLedgerImportAction} encType="multipart/form-data" className="space-y-4 p-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Base de pólizas CSV</span>
                    <input
                      type="file"
                      name="ledgerCsv"
                      accept=".csv,.xls,.xlsx"
                      required
                      className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Pagos Hechos XLS</span>
                    <input
                      type="file"
                      name="ledgerPaid"
                      accept=".xls,.xlsx,.csv"
                      required
                      className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" className="rounded-full">
                    Generar preview
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    El preview guarda un batch auditable y deja los casos ambiguos listos para revisión humana.
                  </p>
                </div>
              </form>

              {previewBatch ? (
                <div className="border-t border-border/70 px-4 py-4">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">CSV</p>
                      <p className="mt-1 text-sm font-medium">{previewBatch.sourceCsvName}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">XLS</p>
                      <p className="mt-1 text-sm font-medium">{previewBatch.sourcePaidName}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
                      <p className="mt-1 text-sm font-medium">{previewBatch.status}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Creado</p>
                      <p className="mt-1 text-sm font-medium">{previewBatch.createdAt.toLocaleString("es-MX")}</p>
                    </div>
                  </div>
                  {previewSummary ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {Object.entries(previewSummary).map(([key, value]) => {
                        if (key === "sampleIssues") return null;
                        if (Array.isArray(value)) return null;
                        return (
                          <div key={key} className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4 text-sm">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">{key}</p>
                            <p className="mt-1 font-medium">{String(value)}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">Aprobación ADMIN por bloque</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Listos para aplicar: {readyRowCount}. En revisión: {reviewRowCount}. Solo se crearán pagos con evidencia XLS, importe positivo, fecha no futura y match único.
                      </p>
                    </div>
                    <form action={applyLedgerImportBatchAction}>
                      <input type="hidden" name="batchId" value={previewBatch.id} />
                      <Button
                        type="submit"
                        className="rounded-full"
                        disabled={!["PREVIEW_READY", "APPROVED", "PARTIAL_APPLIED"].includes(previewBatch.status) || readyRowCount === 0}
                      >
                        Aprobar y aplicar pagos
                      </Button>
                    </form>
                  </div>

                  {previewBatch.issues.length ? (
                    <div className="mt-5 overflow-hidden rounded-2xl border border-stone-200/80">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead>Tipo</TableHead>
                            <TableHead>Severidad</TableHead>
                            <TableHead>Mensaje</TableHead>
                            <TableHead className="text-right">Fila</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewBatch.issues.map((issue) => (
                            <TableRow key={issue.id}>
                              <TableCell className="font-medium">{issue.issueType}</TableCell>
                              <TableCell>{issue.severity}</TableCell>
                              <TableCell>{issue.message}</TableCell>
                              <TableCell className="text-right">{issue.row?.rowNumber ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Issues de ledger por revisar"
              description="Cada fila queda agrupada por lote para que puedas aprobar o revisar por categoría."
            >
              {openLedgerIssues.length === 0 ? (
                <div className="p-4">
                  <BadgeCheck className="mb-3 size-5 text-emerald-500" />
                  <p className="text-sm text-muted-foreground">No hay issues abiertos de ledger.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <form action={bulkLedgerIssuesAction} className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead className="w-10">
                              <span className="sr-only">Seleccionar</span>
                            </TableHead>
                            <TableHead>Lote</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Severidad</TableHead>
                            <TableHead>Mensaje</TableHead>
                            <TableHead className="text-right">Fila</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openLedgerIssues.map((issue) => (
                            <TableRow key={issue.issueId}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  name="issueIds"
                                  value={issue.issueId}
                                  className="size-4 rounded border-border text-primary"
                                />
                              </TableCell>
                              <TableCell>
                                <Link href={`/data-quality?tab=ledger&ledgerBatch=${issue.batchId}`} className="font-medium hover:text-primary">
                                  {issue.batchCsvName}
                                </Link>
                                <p className="text-xs text-muted-foreground">{issue.batchPaidName}</p>
                              </TableCell>
                              <TableCell>{issue.issueType}</TableCell>
                              <TableCell>{issue.severity}</TableCell>
                              <TableCell className="max-w-md text-xs text-muted-foreground">{issue.message}</TableCell>
                              <TableCell className="text-right">{issue.rowNumber ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {issue.dispositionLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <ReviewActionButtons
                                  id={issue.issueId}
                                  modifyHref={`/data-quality?tab=ledger&ledgerBatch=${issue.batchId}`}
                                  approveAction={approveLedgerIssue}
                                  denyAction={denyLedgerIssue}
                                  suppressAction={suppressLedgerIssue}
                                  className="flex flex-wrap items-center justify-end gap-2"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4">
                      <p className="text-sm text-muted-foreground">
                        Puedes resolver varios issues iguales al mismo tiempo o fusionarlos si representan el mismo origen.
                      </p>
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button type="submit" name="operation" value="APPROVE" className="rounded-full">
                          Aprobar selección
                        </Button>
                        <Button type="submit" name="operation" value="DENY" variant="outline" className="rounded-full">
                          Denegar selección
                        </Button>
                        <Button type="submit" name="operation" value="SUPPRESS" variant="outline" className="rounded-full">
                          Suprimir selección
                        </Button>
                        <Button type="submit" name="operation" value="MERGE" variant="outline" className="rounded-full">
                          Fusionar selección
                        </Button>
                        <Button type="submit" name="operation" value="REOPEN" variant="ghost" className="rounded-full">
                          Reabrir selección
                        </Button>
                      </div>
                    </div>
                  </form>
                  {closedLedgerIssues.length ? (
                    <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                      <div className="border-b border-stone-200/80 bg-stone-50/70 px-4 py-3">
                        <p className="text-sm font-semibold">Historial reciente</p>
                        <p className="text-xs text-muted-foreground">Issues resueltos, descartados, suprimidos o fusionados.</p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/70">
                            <TableHead>Tipo</TableHead>
                            <TableHead>Lote</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Salida</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {closedLedgerIssues.slice(0, 10).map((issue) => (
                            <TableRow key={issue.issueId}>
                              <TableCell>{issue.issueType}</TableCell>
                              <TableCell>
                                <Link href={`/data-quality?tab=ledger&ledgerBatch=${issue.batchId}`} className="font-medium hover:text-primary">
                                  {issue.batchCsvName}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="rounded-full">
                                  {issue.dispositionLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-md text-xs text-muted-foreground">
                                {issue.resolutionNote ?? issue.message}
                              </TableCell>
                              <TableCell className="text-right">
                                <ReviewActionButtons
                                  id={issue.issueId}
                                  modifyHref={`/data-quality?tab=ledger&ledgerBatch=${issue.batchId}`}
                                  reopenAction={reopenLedgerIssue}
                                  className="flex flex-wrap items-center justify-end gap-2"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </UrlTabs>
      </div>
    </main>
  );
}
