import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BadgeInfo,
  FileWarning,
  FolderKanban,
  ShieldAlert,
  Users,
} from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { SeverityBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { getDb } from "@/lib/db";
import { detectRisks } from "@/lib/risk-engine";
import { getClientDataQualityScores, getPolicyDataQualityScores } from "@/lib/data-quality";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { ClientResolutionActions, PolicyResolutionActions, RenewalResolutionActions } from "@/components/risk-resolution/resolution-actions";
import { PageRefreshTicker } from "@/components/risk-resolution/page-refresh-ticker";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";
import { requireOrganizationRoleOrRedirect } from "@/lib/organization-context";
import { statusLabel } from "@/lib/status";

function riskHref(entityType: string, entityId: string) {
  if (entityType === "Client") return `/clients/${entityId}`;
  if (entityType === "Policy") return `/policies/${entityId}`;
  if (entityType === "Receipt") return `/receipts/${entityId}`;
  if (entityType === "Task" || entityType === "WorkItem") return `/tasks/${entityId}`;
  if (entityType === "Claim") return `/claims/${entityId}`;
  if (entityType === "Quote") return `/quotes/${entityId}`;
  if (entityType === "Document") return `/documents`;
  return "/reports";
}

const RISK_TYPE_LABELS: Record<string, string> = {
  CLIENT_MISSING_CONTACT: "Clientes sin contacto",
  CLIENT_WITHOUT_ACTIVE_POLICY: "Clientes sin pólizas activas",
  RENEWAL_WITHOUT_WORK_ITEM: "Renovaciones sin seguimiento",
  RECEIPT_OVERDUE: "Recibos vencidos",
  COMMISSION_OVERDUE: "Comisiones vencidas",
  STALE_TASK: "Pendientes estancados",
  INCONSISTENT_DATES: "Fechas inconsistentes",
  ORPHAN_DOCUMENT: "Documentos huérfanos",
  OVERLAPPING_POLICY_TERM: "Vigencias solapadas",
  DUPLICATE_RECEIPT_NUMBER: "Recibos duplicados",
  POLICY_WITHOUT_RECEIPTS: "Pólizas sin recibos",
};

const ISSUE_CODE_LABELS: Record<string, string> = {
  POLICY_OBJECT_MISSING: "Objeto asegurado faltante",
  POLICY_PREMIUM_MISSING: "Prima faltante",
  POLICY_PENDING: "Pólizas pendientes",
  POLICY_PAYMENT_FREQUENCY_REVIEW: "Frecuencia de pago para revisar",
  EMAIL_MISSING: "Correo faltante",
  PHONE_MISSING: "Teléfono faltante",
  ADDRESS_MISSING: "Dirección faltante",
  RFC_MISSING: "RFC faltante",
  CONTACT_METHOD_MISSING: "Método de contacto faltante",
  POLICY_WITHOUT_RECEIPTS: "Sin recibos",
};

function getRiskTypeLabel(code: string) {
  return RISK_TYPE_LABELS[code] ?? code;
}

function getIssueCodeLabel(code: string) {
  return ISSUE_CODE_LABELS[code] ?? code;
}

function getRenewalDueLabel(endDate: Date) {
  const remainingDays = daysUntil(endDate);
  if (remainingDays < 0) return `Vencida hace ${Math.abs(remainingDays)} días`;
  if (remainingDays === 0) return "Vence hoy";
  return `En ${remainingDays} días`;
}

function QualityBadge({ nivel }: { nivel: "Excelente" | "Bueno" | "Atención" | "Crítico" }) {
  const colors = {
    Excelente: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
    Bueno: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60",
    Atención: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60",
    Crítico: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60",
  };
  return <Badge className={`${colors[nivel]} rounded-full`}>{nivel}</Badge>;
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-blue-500" : score >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium">{score}</span>
    </div>
  );
}

export default async function RisksPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; alertType?: string; issueCode?: string; q?: string }>;
}) {
  const organizationContext = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const params = (await searchParams) ?? {};
  const initialTab = params.tab === "completitud" ? "completitud" : "hallazgos";
  const alertTypeFilter = params.alertType;
  const issueCodeFilter = params.issueCode;
  const query = (params.q ?? "").trim().toLowerCase();

  const db = getDb();
  const [risks, openNotifications, clientScores, policyScores] = await Promise.all([
    detectRisks(undefined, organizationContext.organizationId),
    db.alert.findMany({ where: { organizationId: organizationContext.organizationId, status: "OPEN" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    getClientDataQualityScores(organizationContext.organizationId),
    getPolicyDataQualityScores(organizationContext.organizationId),
  ]);

  const matchesQuery = (...values: Array<string | null | undefined>) =>
    !query || values.some((value) => value?.toLowerCase().includes(query));

  const queryMatchedRisks = risks.filter((risk) =>
    matchesQuery(risk.title, risk.description, getRiskTypeLabel(risk.alertType), risk.entityType, risk.suggestedAction),
  );

  const filteredRisks = queryMatchedRisks.filter((risk) => {
    if (alertTypeFilter && risk.alertType !== alertTypeFilter) return false;
    return true;
  });

  const critical = filteredRisks.filter((risk) => risk.severity === "CRITICAL");
  const warnings = filteredRisks.filter((risk) => risk.severity === "WARNING");
  const info = filteredRisks.filter((risk) => risk.severity === "INFO");

  const typeCounts = queryMatchedRisks.reduce<Record<string, number>>((acc, risk) => {
    acc[risk.alertType] = (acc[risk.alertType] ?? 0) + 1;
    return acc;
  }, {});
  const topTypes = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const avgClientScore = Math.round(
    clientScores.reduce((sum, c) => sum + c.score, 0) / (clientScores.length || 1),
  );
  const avgPolicyScore = Math.round(
    policyScores.reduce((sum, p) => sum + p.score, 0) / (policyScores.length || 1),
  );
  const clientScoreById = new Map(clientScores.map((client) => [client.clienteId, client] as const));
  const policyScoreById = new Map(policyScores.map((policy) => [policy.polizaId, policy] as const));
  const clientCritical = clientScores.filter((c) => c.nivel === "Crítico").length;
  const policyCritical = policyScores.filter((p) => p.score < 50).length;
  const clientAttention = clientScores.filter((c) => c.nivel === "Atención").length;
  const policyAttention = policyScores.filter((p) => p.score >= 50 && p.score < 75).length;

  const filteredClientScores = issueCodeFilter
    ? clientScores.filter((c) => c.issues.some((i) => i.code === issueCodeFilter))
    : clientScores;
  const filteredPolicyScores = issueCodeFilter
    ? policyScores.filter((p) => p.issues.some((i) => i.code === issueCodeFilter))
    : policyScores;
  const searchedClientScores = filteredClientScores.filter((client) =>
    matchesQuery(client.cliente, ...client.issues.map((issue) => issue.etiqueta), ...client.issues.map((issue) => issue.descripcion)),
  );
  const searchedPolicyScores = filteredPolicyScores.filter((policy) =>
    matchesQuery(
      policy.poliza,
      policy.cliente,
      policy.aseguradora,
      ...policy.issues.map((issue) => issue.etiqueta),
      ...policy.issues.map((issue) => issue.descripcion),
    ),
  );

  const allIssues = [
    ...clientScores.flatMap((c) => c.issues.map((i) => ({ ...i, entity: c.cliente }))),
    ...policyScores.flatMap((p) => p.issues.map((i) => ({ ...i, entity: p.poliza }))),
  ];
  const issueCounts = allIssues.reduce<Record<string, { count: number; label: string }>>((acc, issue) => {
    if (!acc[issue.code]) acc[issue.code] = { count: 0, label: issue.etiqueta };
    acc[issue.code].count += 1;
    return acc;
  }, {});
  const topIssues = Object.entries(issueCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <PageRefreshTicker />
      <PageHeader
        eyebrow="Calidad"
        title="Riesgos y calidad"
        description="Hallazgos del motor de calidad y completitud de datos en una sola vista."
        actions={
          <>
            <RefreshPageButton />
            <Button asChild>
              <Link href="/documents">
                Documentos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Riesgos totales"
          value={risks.length}
          description="Hallazgos activos."
          icon={ShieldAlert}
          tone="rose"
        />
        <MetricCard title="Críticos" value={critical.length} description="Acción prioritaria." icon={AlertTriangle} tone="rose" />
        <MetricCard title="Advertencias" value={warnings.length} description="Mejora operativa." icon={BadgeInfo} tone="amber" />
        <MetricCard
          title="Notificaciones abiertas"
          value={openNotifications.length}
          description={`${info.length} señales informativas`}
          icon={ShieldAlert}
          tone="emerald"
        />
        <MetricCard
          title="Puntuación de clientes"
          value={avgClientScore}
          description={`Promedio de ${clientScores.length}`}
          icon={Users}
          tone={avgClientScore >= 75 ? "emerald" : avgClientScore >= 50 ? "amber" : "rose"}
        />
        <MetricCard
          title="Puntuación de pólizas"
          value={avgPolicyScore}
          description={`Promedio de ${policyScores.length}`}
          icon={FolderKanban}
          tone={avgPolicyScore >= 75 ? "emerald" : avgPolicyScore >= 50 ? "amber" : "rose"}
        />
      </section>

      <UrlTabs defaultValue={initialTab}>
        <TabsList className="bg-card/70 p-1">
          <TabsTrigger value="hallazgos" className="px-4">
            Hallazgos
          </TabsTrigger>
          <TabsTrigger value="completitud" className="px-4">
            Completitud
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hallazgos" className="space-y-6">
          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <SectionCard title="Hallazgos" description={alertTypeFilter ? `Filtrado por: ${getRiskTypeLabel(alertTypeFilter)}` : "Ordenados por severidad y utilidad inmediata."}>
              {filteredRisks.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {alertTypeFilter ? "No hay hallazgos de este tipo." : "No hay hallazgos activos. ¡Cartera limpia!"}
                </div>
              ) : (
                <div className="divide-y divide-stone-200/80">
                  {filteredRisks.slice(0, 12).map((risk) => {
                    const renewalPolicy = risk.alertType === "RENEWAL_WITHOUT_WORK_ITEM" ? policyScoreById.get(risk.entityId) : null;

                    return (
                      <div
                        key={`${risk.alertType}-${risk.entityId}-${risk.title}`}
                        className="flex items-start justify-between gap-4 px-4 py-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{risk.title}</p>
                            <SeverityBadge severity={risk.severity} />
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{risk.description}</p>
                          {renewalPolicy ? (
                            <div className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                              <p className="min-w-0 truncate">
                                <span className="text-muted-foreground">Cliente:</span>{" "}
                                <span className="font-medium text-foreground">{renewalPolicy.cliente}</span>
                              </p>
                              <p className="min-w-0 truncate">
                                <span className="text-muted-foreground">Aseguradora:</span>{" "}
                                <span className="font-medium text-foreground">{renewalPolicy.aseguradora}</span>
                              </p>
                              <p className="min-w-0 truncate">
                                <span className="text-muted-foreground">Vence:</span>{" "}
                                <span className="font-medium text-foreground">
                                  {formatDate(renewalPolicy.endDate)} · {getRenewalDueLabel(renewalPolicy.endDate)}
                                </span>
                              </p>
                              <p className="min-w-0 truncate">
                                <span className="text-muted-foreground">Póliza:</span>{" "}
                                <span className="font-medium text-foreground">{renewalPolicy.poliza}</span>
                              </p>
                            </div>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {risk.entityType} · {getRiskTypeLabel(risk.alertType)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {renewalPolicy ? (
                            <RenewalResolutionActions
                              mode="policy"
                              sourcePolicyId={risk.entityId}
                              sourcePolicyNumber={renewalPolicy.poliza}
                              clientName={renewalPolicy.cliente}
                              insurerName={renewalPolicy.aseguradora}
                            />
                          ) : risk.alertType === "CLIENT_MISSING_CONTACT" ? (
                            clientScoreById.get(risk.entityId) ? (
                              <ClientResolutionActions
                                clientId={risk.entityId}
                                clientName={clientScoreById.get(risk.entityId)!.cliente}
                                email={clientScoreById.get(risk.entityId)!.email}
                                phone={clientScoreById.get(risk.entityId)!.phone}
                                secondaryPhone={clientScoreById.get(risk.entityId)!.secondaryPhone}
                                address={clientScoreById.get(risk.entityId)!.address}
                                rfc={clientScoreById.get(risk.entityId)!.rfc}
                                preferredContactMethod={clientScoreById.get(risk.entityId)!.preferredContactMethod}
                                notes={null}
                                issueCodes={[risk.alertType]}
                              />
                            ) : null
                          ) : risk.alertType === "CLIENT_WITHOUT_ACTIVE_POLICY" ? (
                            clientScoreById.get(risk.entityId) ? (
                              <ClientResolutionActions
                                clientId={risk.entityId}
                                clientName={clientScoreById.get(risk.entityId)!.cliente}
                                email={clientScoreById.get(risk.entityId)!.email}
                                phone={clientScoreById.get(risk.entityId)!.phone}
                                secondaryPhone={clientScoreById.get(risk.entityId)!.secondaryPhone}
                                address={clientScoreById.get(risk.entityId)!.address}
                                rfc={clientScoreById.get(risk.entityId)!.rfc}
                                preferredContactMethod={clientScoreById.get(risk.entityId)!.preferredContactMethod}
                                notes={null}
                                issueCodes={[risk.alertType]}
                                allowClose={true}
                                allowEdit={false}
                                consolidateLabel="Consolidar"
                              />
                            ) : null
                          ) : (
                            <Button asChild variant="outline" size="sm">
                              <Link href={riskHref(risk.entityType, risk.entityId)}>Abrir</Link>
                            </Button>
                          )}
                          <span className="text-xs text-muted-foreground">{risk.suggestedAction}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Tipos de riesgo" description="Dónde está la mayor concentración.">
              {topTypes.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Sin tipos detectados.</div>
              ) : (
                <div className="divide-y divide-stone-200/80">
                  {topTypes.map((entry) => (
                    <Link
                      key={entry.type}
                      href={`/risks?tab=hallazgos&alertType=${encodeURIComponent(entry.type)}`}
                      className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-sm font-medium text-foreground">{getRiskTypeLabel(entry.type)}</p>
                      <Badge variant="secondary" className="rounded-full">{entry.count}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
          </section>
        </TabsContent>

        <TabsContent value="completitud" className="space-y-6">
          {issueCodeFilter && (
            <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-3">
              <Badge variant="secondary">Filtrado: {getIssueCodeLabel(issueCodeFilter)}</Badge>
              <Link href="/risks?tab=completitud">
                <Button variant="ghost" size="sm" className="h-6">Limpiar filtro</Button>
              </Link>
            </div>
          )}
          <TableToolbar searchPlaceholder="Buscar cliente, póliza o hallazgo de calidad..." />
          <section className="grid gap-3 md:grid-cols-2">
            <MetricCard
              title="Críticos"
              value={clientCritical + policyCritical}
              description={`${clientCritical} clientes + ${policyCritical} pólizas`}
              icon={ShieldAlert}
              tone="rose"
            />
            <MetricCard
              title="Atención"
              value={clientAttention + policyAttention}
              description={`${clientAttention} clientes + ${policyAttention} pólizas`}
              icon={AlertTriangle}
              tone="amber"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <SectionCard title="Calidad por cliente" description={issueCodeFilter ? `Filtrado por: ${getIssueCodeLabel(issueCodeFilter)}` : "Peores primero."}>
              {searchedClientScores.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">{issueCodeFilter ? "No hay clientes con este problema." : "No hay clientes para evaluar."}</div>
              ) : (
                <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Cliente</TableHead>
                        <TableHead>Puntuación</TableHead>
                        <TableHead>Nivel</TableHead>
                        <TableHead className="text-right">Pólizas</TableHead>
                        <TableHead className="text-right">Prima</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchedClientScores.slice(0, 10).map((client) => (
                        <TableRow key={client.clienteId}>
                        <TableCell>
                          <Link href={`/clients/${client.clienteId}`} className="font-medium hover:text-primary">
                            {client.cliente}
                          </Link>
                          {client.issues.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {client.issues.slice(0, 3).map((issue) => (
                                <Badge key={issue.code} variant="outline" className="text-xs">
                                  {issue.etiqueta}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <ScoreBar score={client.score} />
                        </TableCell>
                        <TableCell>
                          <QualityBadge nivel={client.nivel} />
                        </TableCell>
                        <TableCell className="text-right">
                          {client.polizasActivas}/{client.totalPolizas}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(client.ingresosEstimados)}
                        </TableCell>
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
                              allowClose={!(
                                client.issues.length === 1 && client.issues[0].code === "CLIENT_WITHOUT_POLICY"
                              )}
                              allowEdit={!(
                                client.issues.length === 1 && client.issues[0].code === "CLIENT_WITHOUT_POLICY"
                              )}
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

            <SectionCard title="Calidad por póliza" description={issueCodeFilter ? `Filtrado por: ${getIssueCodeLabel(issueCodeFilter)}` : "Peores primero."}>
              {searchedPolicyScores.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">{issueCodeFilter ? "No hay pólizas con este problema." : "No hay pólizas para evaluar."}</div>
              ) : (
                <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Póliza</TableHead>
                        <TableHead>Puntuación</TableHead>
                        <TableHead>Nivel</TableHead>
                        <TableHead>Problemas</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchedPolicyScores.slice(0, 10).map((policy) => (
                        <TableRow key={policy.polizaId}>
                        <TableCell>
                          <Link href={`/policies/${policy.polizaId}`} className="font-medium hover:text-primary">
                            {policy.poliza}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {policy.cliente} · {policy.aseguradora} · {statusLabel(policy.status, "policy")}
                          </p>
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
                              {policy.issues.length > 2 ? (
                                <Badge variant="outline" className="text-xs">
                                  +{policy.issues.length - 2}
                                </Badge>
                              ) : null}
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

          <SectionCard title="Problemas más comunes" description="Frecuencia de hallazgos de calidad.">
            {topIssues.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <BadgeCheck className="size-5 text-emerald-500" />
                No hay problemas detectados. ¡Excelente!
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {topIssues.map(([code, dataItem]) => (
                  <Link
                    key={code}
                    href={`/risks?tab=completitud&issueCode=${encodeURIComponent(code)}`}
                    className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <FileWarning className="size-4 text-amber-500" />
                      <span className="text-sm font-medium">{getIssueCodeLabel(code)}</span>
                    </div>
                    <Badge variant="outline">{dataItem.count} casos</Badge>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
