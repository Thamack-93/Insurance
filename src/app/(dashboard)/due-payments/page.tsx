import Link from "next/link";
import { ArrowRight, CircleDollarSign, Clock3, AlertTriangle, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { addDays } from "date-fns";

export default async function DuePaymentsPage() {
  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const in30 = addDays(now, 30);
  const in60 = addDays(now, 60);

  const [allOpenReceipts, overdueReceipts, next7Receipts, next30Receipts, recentPaidReceipts] = await Promise.all([
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in60 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
    }),
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { dueDate: { gt: in7, lte: in30 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { status: "PAID" },
      include: { client: true, policy: true, insurer: true },
      orderBy: { paidDate: "desc" },
      take: 10,
    }),
  ]);

  const outstandingAmount = allOpenReceipts.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const overdueAmount = overdueReceipts.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const dueToday = allOpenReceipts.filter((receipt) => daysUntil(receipt.dueDate) === 0).length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Cartera"
          title="Due payments"
          description="Calendario de cobros y vencimientos para concentrar seguimiento comercial y financiero."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/receipts">
                Ver recibos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Saldo por cobrar"
            value={formatCurrency(outstandingAmount)}
            description="Total abierto dentro del horizonte de 60 días."
            icon={CircleDollarSign}
            tone="emerald"
          />
          <MetricCard
            title="Vencidos"
            value={overdueReceipts.length}
            description={formatCurrency(overdueAmount)}
            icon={AlertTriangle}
            tone="rose"
          />
          <MetricCard
            title="Vence hoy"
            value={dueToday}
            description="Recibos que requieren contacto el mismo día."
            icon={Clock3}
            tone="amber"
          />
          <MetricCard
            title="Próximos 7 días"
            value={next7Receipts.length}
            description={`${next30Receipts.length} más entre el día 8 y el 30.`}
            icon={ReceiptText}
            tone="blue"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <SectionCard title="Recibos vencidos" description="Máxima prioridad operativa y de cobranza.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueReceipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                    <TableCell>
                      <Link href={`/clients/${receipt.clientId}`} className="text-foreground hover:text-primary">
                        {receipt.client.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/policies/${receipt.policyId}`} className="text-foreground hover:text-primary">
                        {receipt.policy.policyNumber}
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

          <SectionCard title="Plan de la semana" description="Cobros que conviene contactar primero.">
            <div className="divide-y divide-stone-200/80">
              {next7Receipts.map((receipt) => (
                <div key={receipt.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/policies/${receipt.policyId}`} className="font-medium text-foreground hover:text-primary">
                        {receipt.receiptNumber}
                      </Link>
                      <StatusBadge status={receipt.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      <Link href={`/clients/${receipt.clientId}`} className="hover:text-primary">
                        {receipt.client.fullName}
                      </Link>
                      {" · "}
                      {receipt.policy.policyNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Vence en {daysUntil(receipt.dueDate)} días · {formatDate(receipt.dueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(receipt.amount, receipt.currency)}</p>
                    <p className="text-xs text-muted-foreground">{receipt.insurer.name}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <SectionCard title="Cobros entre 8 y 30 días" description="El segundo carril de seguimiento.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Días</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {next30Receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                    <TableCell>{receipt.client.fullName}</TableCell>
                    <TableCell>{daysUntil(receipt.dueDate)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(receipt.amount, receipt.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Pagos recientes" description="Liquidaciones confirmadas para referencia rápida.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPaidReceipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                    <TableCell>{receipt.client.fullName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{receipt.paidDate ? formatDate(receipt.paidDate) : "Sin fecha"}</span>
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
