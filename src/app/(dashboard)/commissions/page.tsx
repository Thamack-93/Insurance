import Link from "next/link";
import { ArrowRight, BadgeCheck, CircleAlert, HandCoins, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function CommissionsPage() {
  const db = getDb();
  const now = today();

  const commissions = await db.commission.findMany({
    include: { client: true, insurer: true, policy: true, receipt: true },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });

  const expectedTotal = commissions.reduce((sum, commission) => sum + toNumber(commission.expectedAmount), 0);
  const actualTotal = commissions.reduce((sum, commission) => sum + toNumber(commission.actualAmount ?? commission.expectedAmount), 0);
  const openCommissions = commissions.filter((commission) => commission.status !== "PAID" && commission.status !== "CANCELLED");
  const overdueCommissions = commissions.filter((commission) => commission.status === "OVERDUE" || commission.expectedDate < now);
  const paidCommissions = commissions.filter((commission) => commission.status === "PAID");
  const ratio = expectedTotal ? Math.round((actualTotal / expectedTotal) * 100) : 0;

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Commissions"
          description="Seguimiento de ingreso esperado, cobrado y vencido por póliza."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/reports">
                Reportes
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Esperado"
            value={formatCurrency(expectedTotal)}
            description="Suma de comisiones registradas."
            icon={HandCoins}
            tone="emerald"
          />
          <MetricCard
            title="Cobrado"
            value={formatCurrency(actualTotal)}
            description={`${ratio}% de conversión sobre lo esperado`}
            icon={TrendingUp}
            tone="blue"
          />
          <MetricCard
            title="Abiertas"
            value={openCommissions.length}
            description="Todavía en espera de liquidación."
            icon={BadgeCheck}
            tone="amber"
          />
          <MetricCard
            title="Vencidas"
            value={overdueCommissions.length}
            description="Esperadas en el pasado sin cierre."
            icon={CircleAlert}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Comisiones abiertas" description="Ordenadas por fecha esperada.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Esperada</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openCommissions.slice(0, 10).map((commission) => (
                  <TableRow key={commission.id}>
                    <TableCell>
                      <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                        {commission.policy.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{commission.client.fullName}</TableCell>
                    <TableCell>{commission.insurer.name}</TableCell>
                    <TableCell>{formatDate(commission.expectedDate)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(commission.expectedAmount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={commission.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Comisiones cobradas" description="Últimos cierres que ya entraron a caja.">
            <div className="divide-y divide-stone-200/80">
              {paidCommissions.slice(0, 10).map((commission) => (
                <div key={commission.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {commission.policy.policyNumber}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.client.fullName} · {commission.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {commission.paidDate ? formatDate(commission.paidDate) : formatDate(commission.expectedDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(commission.actualAmount ?? commission.expectedAmount)}</p>
                    <StatusBadge status={commission.status} className="mt-1 w-fit" />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
