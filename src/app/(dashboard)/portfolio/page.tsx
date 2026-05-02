import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, ShieldCheck, Users } from "lucide-react";
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

export default async function PortfolioPage() {
  const db = getDb();
  const now = today();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);

  const [activePolicies, clients, insurers, dueReceipts, activePolicyCount, activeClientCount, activeInsurerCount] =
    await Promise.all([
      db.policy.findMany({
        where: { status: "ACTIVE" },
        include: { client: true, insurer: true },
        orderBy: [{ premiumAmount: "desc" }, { renewalDate: "asc" }],
        take: 50,
      }),
      db.client.findMany({
        include: {
          policies: { select: { premiumAmount: true, status: true } },
        },
      }),
      db.insurer.findMany({
        include: {
          policies: { select: { premiumAmount: true, status: true } },
        },
      }),
      db.receipt.findMany({
        where: { dueDate: { gte: now, lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
        include: { client: true, policy: true, insurer: true },
        orderBy: { dueDate: "asc" },
        take: 10,
      }),
      db.policy.count({ where: { status: "ACTIVE" } }),
      db.client.count({ where: { status: "ACTIVE" } }),
      db.insurer.count({ where: { status: "ACTIVE" } }),
    ]);

  const portfolioValue = activePolicies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);
  const renewalSoon = activePolicies.filter((policy) => policy.renewalDate && daysUntil(policy.renewalDate) <= 60);
  const activeByInsurer = insurers
    .map((insurer) => ({
      id: insurer.id,
      name: insurer.name,
      policies: insurer.policies.length,
      value: insurer.policies
        .filter((policy) => policy.status === "ACTIVE")
        .reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const activeByClient = clients
    .map((client) => ({
      id: client.id,
      name: client.fullName,
      policies: client.policies.filter((policy) => policy.status === "ACTIVE").length,
      value: client.policies
        .filter((policy) => policy.status === "ACTIVE")
        .reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0),
    }))
    .filter((client) => client.policies > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Cartera"
          title="Cartera"
          description="Vista ejecutiva de la cartera activa, su concentración y las renovaciones más cercanas."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/renewals">Renovaciones</Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/policies">
                  Ver pólizas
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Cartera activa"
            value={formatCurrency(portfolioValue)}
            description={`${activePolicyCount} pólizas activas en ${activeInsurerCount} aseguradoras`}
            icon={ShieldCheck}
            tone="emerald"
          />
          <MetricCard
            title="Clientes activos"
            value={activeClientCount}
            description="Clientes con operación viva y seguimiento potencial."
            icon={Users}
            tone="blue"
          />
          <MetricCard
            title="Renovaciones 60 días"
            value={renewalSoon.length}
            description="Polizas activas con vencimiento próximo."
            icon={CalendarDays}
            tone="amber"
          />
          <MetricCard
            title="Recibos próximos"
            value={dueReceipts.length}
            description="Cobros del siguiente horizonte de 60 días."
            icon={Building2}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <SectionCard
            title="Pólizas activas"
            description="Ordenadas por prima para ver dónde está concentrado el negocio."
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Renovación</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activePolicies.slice(0, 10).map((policy) => (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Concentración por aseguradora" description="Valor activo por partner.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Aseguradora</TableHead>
                  <TableHead className="text-right">Pólizas</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeByInsurer.map((insurer) => (
                  <TableRow key={insurer.id}>
                    <TableCell className="font-medium">{insurer.name}</TableCell>
                    <TableCell className="text-right">{insurer.policies}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(insurer.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <SectionCard title="Clientes con mayor exposición" description="Clientes activos ordenados por valor de prima.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Pólizas</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeByClient.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:text-primary">
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{client.policies}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(client.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Recibos próximos" description="Cobros ya en el radar para las próximas semanas.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dueReceipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell>
                      <Link href={`/policies/${receipt.policyId}`} className="font-medium text-foreground hover:text-primary">
                        {receipt.receiptNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clients/${receipt.clientId}`} className="text-foreground hover:text-primary">
                        {receipt.client.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{formatDate(receipt.dueDate)}</span>
                        <StatusBadge status={receipt.status} className="mt-1 w-fit" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(receipt.amount, receipt.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
