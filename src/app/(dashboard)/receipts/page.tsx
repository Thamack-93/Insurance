import Link from "next/link";
import { addDays, startOfMonth } from "date-fns";
import { ArrowRight, BadgeCheck, CircleDollarSign, Plus, ReceiptText, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CollectableReceipts } from "@/components/receipts/collectable-receipts";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const initialTab = params.tab === "historico" ? "historico" : "cobrar";

  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const monthStart = startOfMonth(now);

  const [
    allOpenReceipts,
    overdueReceipts,
    next7Receipts,
    laterReceipts,
    paidThisMonth,
    paymentHistory,
  ] = await Promise.all([
    db.receipt.findMany({
      where: { status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
    }),
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
    }),
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
    }),
    db.receipt.findMany({
      where: { dueDate: { gt: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 30,
    }),
    db.receipt.findMany({
      where: { status: "PAID", paidDate: { gte: monthStart } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { paidDate: "desc" },
    }),
    db.payment.findMany({
      include: {
        receipt: { select: { id: true, receiptNumber: true, dueDate: true } },
        client: { select: { id: true, fullName: true } },
        policy: { select: { id: true, policyNumber: true } },
      },
      orderBy: { paidDate: "desc" },
      take: 50,
    }),
  ]);

  const outstandingAmount = allOpenReceipts.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const overdueAmount = overdueReceipts.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const paidAmountMonth = paidThisMonth.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const collectionRate =
    allOpenReceipts.length + paidThisMonth.length > 0
      ? Math.round((paidThisMonth.length / (allOpenReceipts.length + paidThisMonth.length)) * 100)
      : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Recibos y pagos"
        description="Una sola vista para cobrar lo abierto y auditar lo cobrado."
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
          title="Pagado este mes"
          value={paidThisMonth.length}
          description={formatCurrency(paidAmountMonth)}
          icon={BadgeCheck}
          tone="blue"
        />
        <MetricCard
          title="Tasa de cobro"
          value={`${collectionRate}%`}
          description="Pagados vs. abiertos del mes."
          icon={ReceiptText}
          tone="amber"
        />
      </section>

      <UrlTabs defaultValue={initialTab}>
        <TabsList className="rounded-full bg-white/70 p-1">
          <TabsTrigger value="cobrar" className="rounded-full px-4">
            Cobrar
          </TabsTrigger>
          <TabsTrigger value="historico" className="rounded-full px-4">
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cobrar" className="space-y-4">
          <CollectableReceipts
            groups={[
              {
                title: "Vencidos",
                tone: "rose",
                emptyMessage: "No hay recibos vencidos. ¡Cartera al día!",
                receipts: overdueReceipts.map(serializeReceiptForCollect),
              },
              {
                title: "Próximos 7 días",
                tone: "amber",
                emptyMessage: "Sin recibos por vencer en la próxima semana.",
                receipts: next7Receipts.map(serializeReceiptForCollect),
              },
              {
                title: "Próximos vencimientos",
                tone: "emerald",
                emptyMessage: "No hay recibos abiertos a futuro.",
                receipts: laterReceipts.map(serializeReceiptForCollect),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="historico" className="space-y-6">
          <SectionCard
            title="Pagos registrados"
            description="Últimos 50 pagos conciliados con su recibo origen."
          >
            {paymentHistory.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Aún no hay pagos registrados.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Póliza</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentHistory.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        <Link href={`/receipts/${payment.receipt.id}`} className="hover:text-primary">
                          {payment.receipt.receiptNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{payment.client.fullName}</TableCell>
                      <TableCell>
                        <Link href={`/policies/${payment.policy.id}`} className="hover:text-primary">
                          {payment.policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(payment.paidDate)}</TableCell>
                      <TableCell>{payment.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(payment.amount, payment.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard
            title="Recibos cobrados este mes"
            description="Confirmaciones registradas en el período actual."
          >
            {paidThisMonth.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Aún no se han cobrado recibos este mes.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paidThisMonth.slice(0, 30).map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">
                        <Link href={`/receipts/${receipt.id}`} className="hover:text-primary">
                          {receipt.receiptNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{receipt.client.fullName}</TableCell>
                      <TableCell>{receipt.paidDate ? formatDate(receipt.paidDate) : "—"}</TableCell>
                      <TableCell>{receipt.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}

type DbReceipt = {
  id: string;
  receiptNumber: string;
  dueDate: Date;
  amount: unknown;
  currency: string;
  status: string;
  client: { fullName: string };
  policy: { policyNumber: string };
  insurer: { name: string };
};

function serializeReceiptForCollect(receipt: DbReceipt) {
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    dueDate: receipt.dueDate.toISOString().split("T")[0],
    amount: toNumber(receipt.amount),
    currency: receipt.currency,
    status: receipt.status,
    client: { fullName: receipt.client.fullName },
    policy: { policyNumber: receipt.policy.policyNumber },
    insurer: { name: receipt.insurer.name },
  };
}
