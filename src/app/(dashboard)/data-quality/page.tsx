import Link from "next/link";
import { ArrowRight, BadgeCheck, AlertTriangle, FileWarning, ShieldAlert, Users, FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getClientDataQualityScores, getPolicyDataQualityScores } from "@/lib/data-quality";
import { formatCurrency } from "@/lib/money";

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

export default async function DataQualityPage() {
  const [clientScores, policyScores] = await Promise.all([
    getClientDataQualityScores(),
    getPolicyDataQualityScores(),
  ]);

  const avgClientScore = Math.round(
    clientScores.reduce((sum, c) => sum + c.score, 0) / (clientScores.length || 1)
  );
  const avgPolicyScore = Math.round(
    policyScores.reduce((sum, p) => sum + p.score, 0) / (policyScores.length || 1)
  );

  const clientCritical = clientScores.filter((c) => c.score < 50).length;
  const clientAttention = clientScores.filter((c) => c.score >= 50 && c.score < 75).length;
  const policyCritical = policyScores.filter((p) => p.score < 50).length;
  const policyAttention = policyScores.filter((p) => p.score >= 50 && p.score < 75).length;

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

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Calidad"
          title="Data Quality"
          description="Puntuación de completitud y calidad de datos de clientes y pólizas."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/risks">
                Ver riesgos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

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
          <SectionCard
            title="Calidad por cliente"
            description="Ordenados por score ascendente (peores primero)."
          >
            {clientScores.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay clientes para evaluar.
              </div>
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
                        <Link
                          href={`/clients/${client.clienteId}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {client.cliente}
                        </Link>
                        {client.issues.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {client.issues.length} problema(s)
                          </p>
                        )}
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

          <SectionCard
            title="Calidad por póliza"
            description="Ordenados por score ascendente (peores primero)."
          >
            {policyScores.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay pólizas para evaluar.
              </div>
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
                        <Link
                          href={`/policies/${policy.polizaId}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {policy.poliza}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {policy.cliente}
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
                              <Badge
                                key={issue.code}
                                variant="outline"
                                className="text-xs"
                              >
                                {issue.etiqueta}
                              </Badge>
                            ))}
                            {policy.issues.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{policy.issues.length - 2}
                              </Badge>
                            )}
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

        <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
          <SectionCard title="Problemas más comunes" description="Frecuencia de hallazgos de calidad.">
            {topIssues.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay problemas detectados. ¡Excelente trabajo!
              </div>
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

          <SectionCard title="Clientes con problemas críticos" description="Requieren atención prioritaria.">
            {clientCritical === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="size-5 text-emerald-500" />
                  No hay clientes en estado crítico. ¡Felicitaciones!
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Cliente</TableHead>
                    <TableHead>Problemas</TableHead>
                    <TableHead>Acción sugerida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientScores
                    .filter((c) => c.score < 50)
                    .slice(0, 10)
                    .map((client) => (
                      <TableRow key={client.clienteId}>
                        <TableCell>
                          <Link
                            href={`/clients/${client.clienteId}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {client.cliente}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            Score: {client.score} · Completitud: {client.completitud}%
                          </p>
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
                            <Link href={`/clients/${client.clienteId}/edit`}>
                              Completar datos
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
