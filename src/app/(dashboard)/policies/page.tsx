import Link from "next/link";
import { addDays } from "date-fns";
import { ArrowRight, Shield, CalendarClock, AlertCircle, BadgeDollarSign } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

export default async function PoliciesPage() {
  const db = getDb();
  const now = today();
  const in60 = addDays(now, 60);

  const policies = await db.policy.findMany({
    include: { client: true, insurer: true },
    orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
  });

  const activePolicies = policies.filter((policy) => policy.status === "ACTIVE");
  const pendingPolicies = policies.filter((policy) => policy.status === "PENDING");
  const expiredPolicies = policies.filter((policy) => policy.status === "EXPIRED");
  const renewals60 = policies.filter((policy) => policy.status === "ACTIVE" && policy.renewalDate && policy.renewalDate <= in60);
  const portfolioValue = activePolicies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);
  const topPolicies = [...activePolicies].sort((a, b) => toNumber(b.premiumAmount) - toNumber(a.premiumAmount)).slice(0, 10);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Pólizas"
          description="Inventario vivo de pólizas, con foco en estado, valor y renovación."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/portfolio">
                Portfolio
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Pólizas activas"
            value={activePolicies.length}
            description={formatCurrency(portfolioValue)}
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Renovaciones 60 días"
            value={renewals60.length}
            description="Pólizas activas con ventana de seguimiento."
            icon={CalendarClock}
            tone="amber"
          />
          <MetricCard
            title="Pendientes"
            value={pendingPolicies.length}
            description="Pólizas en captación o por finalizar."
            icon={BadgeDollarSign}
            tone="blue"
          />
          <MetricCard
            title="Vencidas"
            value={expiredPolicies.length}
            description="Pólizas que requieren atención inmediata."
            icon={AlertCircle}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <SectionCard title="Inventario principal" description="Pólizas activas ordenadas por prima.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Renovación</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPolicies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                        {policy.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clients/${policy.clientId}`} className="text-foreground hover:text-primary">
                        {policy.client.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>{policy.insurer.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full">
                        {policyTypeLabel(policy.policyType)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {policy.renewalDate ? (
                        <span className="text-sm text-muted-foreground">
                          {formatDate(policy.renewalDate)} · {daysUntil(policy.renewalDate)} días
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin fecha</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                    <TableCell>
                      <StatusBadge status={policy.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Atención inmediata" description="Pólizas que más probablemente requieran intervención.">
            <div className="divide-y divide-stone-200/80">
              {[...expiredPolicies.slice(0, 5), ...pendingPolicies.slice(0, 5)].map((policy) => (
                <div key={policy.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                      {policy.policyNumber}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {policy.client.fullName} · {policy.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {policy.renewalDate ? formatDate(policy.renewalDate) : "Sin renovación"} · {policyTypeLabel(policy.policyType)}
                    </p>
                  </div>
                  <StatusBadge status={policy.status} className="w-fit" />
                </div>
              ))}
            </div>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
