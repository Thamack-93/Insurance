import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeInfo, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { SeverityBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { detectRisks } from "@/lib/risk-engine";

function riskHref(entityType: string, entityId: string) {
  if (entityType === "Client") return `/clients/${entityId}`;
  if (entityType === "Policy") return `/policies/${entityId}`;
  if (entityType === "Receipt") return `/receipts`;
  if (entityType === "Task") return `/tasks`;
  if (entityType === "Document") return `/documents`;
  return "/reports";
}

export default async function RisksPage() {
  const db = getDb();
  const [risks, openAlerts, policies, receipts, clients, documents] = await Promise.all([
    detectRisks(),
    db.alert.findMany({ where: { status: "OPEN" } }),
    db.policy.count(),
    db.receipt.count(),
    db.client.count(),
    db.document.count(),
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Calidad"
          title="Risks"
          description="Señales de integridad y operación que conviene resolver antes de escalar."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/documents">
                Documentos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Riesgos totales"
            value={risks.length}
            description="Hallazgos activos del motor de calidad."
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            title="Críticos"
            value={critical.length}
            description="Requieren corrección prioritaria."
            icon={AlertTriangle}
            tone="amber"
          />
          <MetricCard
            title="Advertencias"
            value={warnings.length}
            description="Puntos de mejora con impacto operativo."
            icon={BadgeInfo}
            tone="blue"
          />
          <MetricCard
            title="Alertas abiertas"
            value={openAlerts.length}
            description={`${info.length} señales informativas y ${openAlerts.length} alertas activas en la base.`}
            icon={ShieldAlert}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <SectionCard title="Hallazgos" description="Ordenados por severidad y utilidad inmediata.">
            <div className="divide-y divide-stone-200/80">
              {risks.slice(0, 12).map((risk) => (
                <div key={`${risk.alertType}-${risk.entityId}-${risk.title}`} className="flex items-start justify-between gap-4 px-4 py-4">
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
          </SectionCard>

          <SectionCard title="Tipos de riesgo" description="Dónde está la mayor concentración de problemas.">
            <div className="divide-y divide-stone-200/80">
              {topTypes.map((entry) => (
                <div key={entry.type} className="flex items-center justify-between gap-4 px-4 py-4">
                  <p className="text-sm font-medium text-foreground">{entry.type}</p>
                  <p className="text-sm text-muted-foreground">{entry.count}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <SectionCard title="Cobertura de entidades" description="Volumen base sobre el que se calculan las alertas.">
          <div className="grid gap-4 p-4 md:grid-cols-4">
            <div className="rounded-2xl border bg-white/70 p-4">
              <p className="text-sm text-muted-foreground">Clientes</p>
              <p className="mt-2 text-2xl font-semibold">{clients}</p>
            </div>
            <div className="rounded-2xl border bg-white/70 p-4">
              <p className="text-sm text-muted-foreground">Pólizas</p>
              <p className="mt-2 text-2xl font-semibold">{policies}</p>
            </div>
            <div className="rounded-2xl border bg-white/70 p-4">
              <p className="text-sm text-muted-foreground">Recibos</p>
              <p className="mt-2 text-2xl font-semibold">{receipts}</p>
            </div>
            <div className="rounded-2xl border bg-white/70 p-4">
              <p className="text-sm text-muted-foreground">Documentos</p>
              <p className="mt-2 text-2xl font-semibold">{documents}</p>
            </div>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
