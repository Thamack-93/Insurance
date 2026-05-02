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
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { SeverityBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { detectRisks } from "@/lib/risk-engine";
import { getClientDataQualityScores, getPolicyDataQualityScores } from "@/lib/data-quality";
import { formatCurrency } from "@/lib/money";

function riskHref(entityType: string, entityId: string) {
  if (entityType === "Client") return `/clients/${entityId}`;
  if (entityType === "Policy") return `/policies/${entityId}`;
  if (entityType === "Receipt") return `/receipts`;
  if (entityType === "Task") return `/tasks`;
  if (entityType === "Document") return `/documents`;
  return "/reports";
}

function QualityBadge({ nivel }: { nivel: "Excelente" | "Bueno" | "Atención" | "Crítico" }) {
  const colors = {
    Excelente: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Bueno: "bg-blue-100 text-blue-700 border-blue-200",
    Atención: "bg-amber-100 text-amber-700 border-amber-200",
    Crítico: "bg-rose-100 text-rose-700 border-rose-200",
  };
  return <Badge className={`${colors[nivel]} rounded-full`}>{nivel}</Badge>;
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-blue-500" : score >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium">{score}</span>
    </div>
  );
}

export default async function RisksPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const initialTab = params.tab === "completitud" ? "completitud" : "hallazgos";

  const db = getDb();
  const [risks, openAlerts, clientScores, policyScores] = await Promise.all([
    detectRisks(),
    db.alert.findMany({ where: { status: "OPEN" } }),
    getClientDataQualityScores(),
    getPolicyDataQualityScores(),
  ]);

  const critical = risks.filter((risk) => risk.severity === "CRITICAL");
  const warnings = risks.filter((risk) => risk.severity === "WARNING");
  const info = risks.filter((risk) => risk.severity === "INFO");

  const typeCounts = risks.reduce<Record<string, number>>((acc, risk) => {
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
  const clientCritical = clientScores.filter((c) => c.score < 50).length;
  const policyCritical = policyScores.filter((p) => p.score < 50).length;
  const clientAttention = clientScores.filter((c) => c.score >= 50 && c.score < 75).length;
  const policyAttention = policyScores.filter((p) => p.score >= 50 && p.score < 75).length;

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
      <PageHeader
        eyebrow="Calidad"
        title="Riesgos y calidad"
        description="Hallazgos del motor de calidad y completitud de datos en una sola vista."
        actions={
          <Button asChild className="rounded-full">
            <Link href="/documents">
              Documentos
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
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
          title="Alertas abiertas"
          value={openAlerts.length}
          description={`${info.length} señales informativas`}
          icon={ShieldAlert}
          tone="emerald"
        />
        <MetricCard
          title="Score clientes"
          value={avgClientScore}
          description={`Promedio de ${clientScores.length}`}
          icon={Users}
          tone={avgClientScore >= 75 ? "emerald" : avgClientScore >= 50 ? "amber" : "rose"}
        />
        <MetricCard
          title="Score pólizas"
          value={avgPolicyScore}
          description={`Promedio de ${policyScores.length}`}
          icon={FolderKanban}
          tone={avgPolicyScore >= 75 ? "emerald" : avgPolicyScore >= 50 ? "amber" : "rose"}
        />
      </section>

      <UrlTabs defaultValue={initialTab}>
        <TabsList className="rounded-full bg-white/70 p-1">
          <TabsTrigger value="hallazgos" className="rounded-full px-4">
            Hallazgos
          </TabsTrigger>
          <TabsTrigger value="completitud" className="rounded-full px-4">
            Completitud
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hallazgos" className="space-y-6">
          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <SectionCard title="Hallazgos" description="Ordenados por severidad y utilidad inmediata.">
              {risks.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No hay hallazgos activos. ¡Cartera limpia!
                </div>
              ) : (
                <div className="divide-y divide-stone-200/80">
                  {risks.slice(0, 12).map((risk) => (
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
                        <p className="mt-1 text-xs text-muted-foreground">
                          {risk.entityType} · {risk.alertType}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Button asChild variant="outline" size="sm" className="rounded-full">
                          <Link href={riskHref(risk.entityType, risk.entityId)}>Abrir</Link>
                        </Button>
                        <span className="text-xs text-muted-foreground">{risk.suggestedAction}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Tipos de riesgo" description="Dónde está la mayor concentración.">
              {topTypes.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Sin tipos detectados.</div>
              ) : (
                <div className="divide-y divide-stone-200/80">
                  {topTypes.map((entry) => (
                    <div key={entry.type} className="flex items-center justify-between gap-4 px-4 py-4">
                      <p className="text-sm font-medium text-foreground">{entry.type}</p>
                      <p className="text-sm text-muted-foreground">{entry.count}</p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </section>
        </TabsContent>

        <TabsContent value="completitud" className="space-y-6">
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
            <SectionCard title="Calidad por cliente" description="Peores primero.">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientScores.slice(0, 10).map((client) => (
                      <TableRow key={client.clienteId}>
                        <TableCell>
                          <Link href={`/clients/${client.clienteId}`} className="font-medium hover:text-primary">
                            {client.cliente}
                          </Link>
                          {client.issues.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {client.issues.length} problema(s)
                            </p>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard title="Calidad por póliza" description="Peores primero.">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyScores.slice(0, 10).map((policy) => (
                      <TableRow key={policy.polizaId}>
                        <TableCell>
                          <Link href={`/policies/${policy.polizaId}`} className="font-medium hover:text-primary">
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
                              {policy.issues.length > 2 ? (
                                <Badge variant="outline" className="text-xs">
                                  +{policy.issues.length - 2}
                                </Badge>
                              ) : null}
                            </div>
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
                  <div key={code} className="flex items-center justify-between gap-4 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <FileWarning className="size-4 text-amber-500" />
                      <span className="text-sm font-medium">{dataItem.label}</span>
                    </div>
                    <Badge variant="outline">{dataItem.count} casos</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
