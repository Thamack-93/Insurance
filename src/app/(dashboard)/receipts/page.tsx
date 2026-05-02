import Link from "next/link";
import { addDays, startOfMonth } from "date-fns";
import { ArrowRight, CircleDollarSign, Plus, ReceiptText, ShieldAlert, BadgeCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function ReceiptsPage() {
  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const monthStart = startOfMonth(now);

  const [allReceipts, overdueReceipts, next7Receipts, paidThisMonth, withDocuments] = await Promise.all([
    db.receipt.findMany({
      include: { client: true, policy: true, insurer: true, document: true },
      orderBy: { dueDate: "asc" },
    }),
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true, document: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true, document: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { status: "PAID", paidDate: { gte: monthStart } },
      include: { client: true, policy: true, insurer: true, document: true },
      orderBy: { paidDate: "desc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { documentId: { not: null } },
      include: { client: true, policy: true, insurer: true, document: true },
      orderBy: { dueDate: "desc" },
      take: 10,
    }),
  ]);

  const outstandingAmount = allReceipts
    .filter((receipt) => receipt.status !== "PAID" && receipt.status !== "CANCELLED")
    .reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const overdueAmount = overdueReceipts.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const pendingCount = allReceipts.filter((receipt) => receipt.status === "PENDING").length;
  const paidAmountMonth = paidThisMonth.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Receipts"
          description="Vista de recibos emitidos, cobrados y pendientes de conciliación."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/receipts/new">
                  <Plus className="mr-2 size-4" />
                  Nuevo recibo
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/due-payments">
                  Cobranza
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Saldo pendiente"
            value={formatCurrency(outstandingAmount)}
            description="Suma de recibos abiertos."
            icon={CircleDollarSign}
            tone="emerald"
          />
          <MetricCard
            title="Vencidos"
            value={overdueReceipts.length}
            description={formatCurrency(overdueAmount)}
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            title="Pendientes"
            value={pendingCount}
            description="Recibos aún no liquidados."
            icon={ReceiptText}
            tone="amber"
          />
          <MetricCard
            title="Pagado este mes"
            value={paidThisMonth.length}
            description={formatCurrency(paidAmountMonth)}
            icon={BadgeCheck}
            tone="blue"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Recibos abiertos" description="Primero los vencidos y luego los próximos siete días.">
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
                {[...overdueReceipts, ...next7Receipts].map((receipt) => (
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

          <SectionCard title="Comprobantes y pagos" description="Recibos con evidencia y pagos ya conciliados.">
            <div className="divide-y divide-stone-200/80">
              {withDocuments.slice(0, 10).map((receipt) => (
                <div key={receipt.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${receipt.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {receipt.receiptNumber}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {receipt.client.fullName} · {receipt.policy.policyNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {receipt.document ? `Con comprobante ${receipt.document.fileName}` : "Sin comprobante principal"}
                    </p>
                  </div>
                  <StatusBadge status={receipt.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <SectionCard title="Pagos cobrados este mes" description="Confirmaciones que ya entraron al flujo de caja.">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50/70">
                <TableHead>Recibo</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidThisMonth.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                  <TableCell>{receipt.client.fullName}</TableCell>
                  <TableCell>{receipt.paidDate ? formatDate(receipt.paidDate) : "Sin fecha"}</TableCell>
                  <TableCell>{receipt.paymentMethod ?? "Sin método"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(receipt.amount, receipt.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </main>
  );
}
