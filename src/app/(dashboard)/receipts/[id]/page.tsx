import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleDollarSign, FileText, History, ReceiptText, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteReceiptButton } from "@/components/receipts/delete-receipt-button";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const receipt = await db.receipt.findUnique({
    where: { id },
    include: { client: true, policy: true, insurer: true, document: true },
  });

  if (!receipt) {
    notFound();
  }

  const [payments, commissions, documents, relatedReceipts, activity] = await Promise.all([
    db.payment.findMany({
      where: { receiptId: id },
      orderBy: { paidDate: "desc" },
    }),
    db.commission.findMany({
      where: { receiptId: id },
      include: { insurer: true },
      orderBy: { expectedDate: "desc" },
    }),
    db.document.findMany({
      where: { receiptId: id },
      orderBy: { uploadedAt: "desc" },
    }),
    db.receipt.findMany({
      where: { policyId: receipt.policyId, id: { not: id } },
      orderBy: { dueDate: "desc" },
      take: 5,
    }),
    getActivityForEntity("Receipt", id, 20),
  ]);

  const paidAmount = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const remainingAmount = toNumber(receipt.amount) - paidAmount;

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title={receipt.receiptNumber}
          description={`${receipt.client.fullName} · ${receipt.policy.policyNumber} · ${receipt.insurer.name}`}
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/receipts/${receipt.id}/edit`}>Editar recibo</Link>
              </Button>
              <DeleteReceiptButton id={receipt.id} receiptNumber={receipt.receiptNumber} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/receipts">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Monto del recibo"
            value={formatCurrency(receipt.amount, receipt.currency)}
            description="Obligación financiera registrada"
            icon={ReceiptText}
            tone="emerald"
          />
          <MetricCard
            title="Estado"
            value={receipt.status}
            description={receipt.paidDate ? `Pagado el ${formatDate(receipt.paidDate)}` : `Vence ${formatDate(receipt.dueDate)}`}
            icon={CircleDollarSign}
            tone={receipt.status === "PAID" ? "blue" : receipt.status === "OVERDUE" ? "rose" : "amber"}
          />
          <MetricCard
            title="Días al vencimiento"
            value={daysUntil(receipt.dueDate)}
            description={receipt.dueDate < new Date() ? "Días vencido" : "Días restantes"}
            icon={CalendarClock}
            tone={receipt.dueDate < new Date() ? "rose" : "blue"}
          />
          <MetricCard
            title="Pagado"
            value={formatCurrency(paidAmount, receipt.currency)}
            description={`${payments.length} pago(s) registrado(s)`}
            icon={FileText}
            tone="blue"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha del recibo" description="Datos de periodo, vencimiento y contexto.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={receipt.status} />
                <Badge variant="outline" className="rounded-full">
                  {receipt.currency}
                </Badge>
              </div>

              <div className="rounded-2xl border bg-muted/40 p-4">
                <p className="font-medium text-foreground">Cliente</p>
                <Link href={`/clients/${receipt.clientId}`} className="mt-1 block text-foreground hover:text-primary">
                  {receipt.client.fullName}
                </Link>
                <p className="mt-3 font-medium text-foreground">Póliza</p>
                <Link href={`/policies/${receipt.policyId}`} className="mt-1 block text-foreground hover:text-primary">
                  {receipt.policy.policyNumber}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {policyTypeLabel(receipt.policy.policyType)}
                </p>
                <p className="mt-3 font-medium text-foreground">Aseguradora</p>
                <p className="mt-1">{receipt.insurer.name}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Periodo inicio</p>
                  <p className="font-medium">{formatDate(receipt.periodStartDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Periodo fin</p>
                  <p className="font-medium">{formatDate(receipt.periodEndDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vencimiento</p>
                  <p className="font-medium">{formatDate(receipt.dueDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Método de pago</p>
                  <p className="font-medium">{receipt.paymentMethod ?? "Sin capturar"}</p>
                </div>
              </div>

              {receipt.notes ? (
                <div className="rounded-2xl border bg-card/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas</p>
                  <p className="mt-1">{receipt.notes}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Pagos registrados" description="Conciliación de pagos contra este recibo.">
            {payments.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay pagos registrados para este recibo.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Fecha de pago</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDate(payment.paidDate)}</TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(payment.amount, payment.currency)}
                      </TableCell>
                      <TableCell>{payment.paymentMethod ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {payment.reference ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="border-t border-border/70 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total pagado:</span>
                <span className="font-medium">{formatCurrency(paidAmount, receipt.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monto del recibo:</span>
                <span className="font-medium">{formatCurrency(receipt.amount, receipt.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Diferencia:</span>
                <span className={`font-medium ${remainingAmount !== 0 ? "text-rose-600" : ""}`}>
                  {formatCurrency(remainingAmount, receipt.currency)}
                </span>
              </div>
            </div>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Comisiones" description="Ingreso esperado y cobrado derivado de este recibo.">
            {commissions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay comisiones registradas para este recibo.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {commissions.map((commission) => (
                  <div key={commission.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {formatCurrency(commission.expectedAmount)}
                      </p>
                      <StatusBadge status={commission.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Esperada: {formatDate(commission.expectedDate)}
                      {commission.paidDate ? ` · Cobrada: ${formatDate(commission.paidDate)}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Documentos" description="Comprobantes y archivos asociados.">
            {documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay documentos asociados a este recibo.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {documents.map((document) => (
                  <div key={document.id} className="px-4 py-4">
                    <p className="font-medium text-foreground">{document.fileName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {document.documentType} · {formatDate(document.uploadedAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{document.mimeType}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>

        <SectionCard title="Recibos relacionados" description="Otros recibos de la misma póliza.">
          {relatedReceipts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No hay otros recibos para esta póliza.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedReceipts.map((related) => (
                  <TableRow key={related.id}>
                    <TableCell>
                      <Link href={`/receipts/${related.id}`} className="font-medium text-foreground hover:text-primary">
                        {related.receiptNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatDate(related.periodStartDate)} - {formatDate(related.periodEndDate)}
                    </TableCell>
                    <TableCell>{formatDate(related.dueDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={related.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(related.amount, related.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Actividad"
          description="Cambios y eventos recientes registrados para este recibo."
          action={
            <Link
              href={`/activity?entity=Receipt&id=${id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver todo el historial
            </Link>
          }
        >
          {activity.length === 0 ? (
            <div className="p-4">
              <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 size-5 text-muted-foreground" />
                Sin actividad registrada para este recibo todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </main>
  );
}
