import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordPageView } from "@/components/recently-viewed/record-page-view";
import { ArrowLeft, FileClock, History, Pencil, ReceiptText, Repeat, Shield } from "lucide-react";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

const frequencyLabels: Record<string, string> = {
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  SINGLE: "Única",
  OTHER: "Otra",
};

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const policy = await db.policy.findUnique({
    where: { id },
    include: { client: true, insurer: true },
  });

  if (!policy) {
    notFound();
  }

  const [receipts, payments, commissions, tasks, documents, activity] = await Promise.all([
    db.receipt.findMany({
      where: { policyId: id },
      include: { client: true, insurer: true },
      orderBy: { dueDate: "desc" },
      take: 10,
    }),
    db.payment.findMany({
      where: { policyId: id },
      include: { client: true },
      orderBy: { paidDate: "desc" },
      take: 10,
    }),
    db.commission.findMany({
      where: { policyId: id },
      include: { client: true, insurer: true, receipt: true },
      orderBy: { expectedDate: "desc" },
      take: 10,
    }),
    db.task.findMany({
      where: { policyId: id },
      include: { client: true, insurer: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 10,
    }),
    db.document.findMany({
      where: { policyId: id },
      include: { receipt: true, task: true, claim: true, quote: true },
      orderBy: { uploadedAt: "desc" },
      take: 10,
    }),
    getActivityForEntity("Policy", id, 20),
  ]);

  const openReceipts = receipts.filter((receipt) => receipt.status !== "PAID" && receipt.status !== "CANCELLED");
  const openCommissions = commissions.filter((commission) => commission.status !== "PAID" && commission.status !== "CANCELLED");
  const openTasks = tasks.filter((task) => task.status !== "RESOLVED" && task.status !== "CANCELLED" && task.status !== "ARCHIVED");
  const paymentsTotal = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <RecordPageView id={policy.id} label={`${policy.policyNumber} · ${policy.client.fullName}`} href={`/policies/${policy.id}`} type="Póliza" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={policy.policyNumber}
          description={`${policy.client.fullName} · ${policy.insurer.name} · ${policyTypeLabel(policy.policyType)}`}
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/policies/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeletePolicyButton id={id} policyNumber={policy.policyNumber} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/policies">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Prima"
            value={formatCurrency(policy.premiumAmount, policy.currency)}
            description={frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Recibos abiertos"
            value={openReceipts.length}
            description="Cargos por cobrar dentro de esta póliza."
            icon={ReceiptText}
            tone="amber"
          />
          <MetricCard
            title="Comisiones abiertas"
            value={openCommissions.length}
            description="Esperadas, pendientes u observadas."
            icon={Repeat}
            tone="blue"
          />
          <MetricCard
            title="Tareas abiertas"
            value={openTasks.length}
            description={policy.renewalDate ? `${daysUntil(policy.renewalDate)} días para renovación` : "Sin renovación capturada"}
            icon={FileClock}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha de póliza" description="Contexto operativo y comercial.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={policy.status} />
                <Badge variant="outline" className="rounded-full">
                  {policyTypeLabel(policy.policyType)}
                </Badge>
              </div>
              <SectionCard title="Relaciones">
                <div className="space-y-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">Cliente</p>
                    <Link href={`/clients/${policy.clientId}`} className="mt-1 block text-foreground hover:text-primary">
                      {policy.client.fullName}
                    </Link>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Aseguradora</p>
                    <p className="mt-1">{policy.insurer.name}</p>
                  </div>
                </div>
              </SectionCard>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Inicio</p>
                  <p className="font-medium">{formatDate(policy.startDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fin</p>
                  <p className="font-medium">{formatDate(policy.endDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Renovación</p>
                  <p className="font-medium">{policy.renewalDate ? formatDate(policy.renewalDate) : "Sin fecha"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Frecuencia</p>
                  <p className="font-medium">{frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}</p>
                </div>
              </div>
              <SectionCard title="Detalle comercial">
                <div className="space-y-3 px-4 py-3 text-sm text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">Objeto asegurado</p>
                    <p className="mt-1">{policy.insuredObject ?? "Sin capturar"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Plan de pago</p>
                    <p className="mt-1">{policy.paymentPlan ?? "Sin capturar"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Beneficiarios</p>
                    <p className="mt-1">{policy.beneficiaryInfo ?? "Sin capturar"}</p>
                  </div>
                </div>
              </SectionCard>
              {policy.notes ? <p className="text-sm text-muted-foreground">{policy.notes}</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="Recibos" description="Calendario de cobro derivado de esta póliza.">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                    <TableCell>{formatDate(receipt.dueDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={receipt.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(receipt.amount, receipt.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Pagos" description="Pagos reales vinculados a la póliza.">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDate(payment.paidDate)}</TableCell>
                    <TableCell>{payment.client.fullName}</TableCell>
                    <TableCell className="font-mono text-xs">{payment.reference ?? "Sin referencia"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(payment.amount, payment.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-border/70 px-4 py-3 text-sm text-muted-foreground">
              Pagos acumulados: <span className="font-medium text-foreground">{formatCurrency(paymentsTotal, policy.currency)}</span>
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Comisiones" description="Cobro esperado de la póliza.">
              <div className="divide-y divide-stone-200/80">
                {commissions.map((commission) => (
                  <div key={commission.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{formatCurrency(commission.expectedAmount, policy.currency)}</p>
                      <StatusBadge status={commission.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.expectedDate ? formatDate(commission.expectedDate) : "Sin fecha"} · {commission.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{commission.receipt?.receiptNumber ?? "Sin recibo asociado"}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Tareas" description="Flujo operativo abierto sobre la póliza.">
              <div className="divide-y divide-stone-200/80">
                {tasks.map((task) => (
                  <div key={task.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{task.folio}</p>
                      <div className="flex gap-2">
                        <PriorityBadge priority={task.priority} />
                        <StatusBadge status={task.status} />
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </section>

        <SectionCard title="Documentos" description="Archivos asociados a esta póliza.">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Archivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Asociación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="font-medium">{document.fileName}</TableCell>
                  <TableCell>{document.documentType}</TableCell>
                  <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                  <TableCell>
                    {document.receipt?.receiptNumber ?? document.task?.folio ?? document.claim?.folio ?? document.quote?.id ?? "Póliza"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard
          title="Actividad"
          description="Cambios y eventos recientes registrados para esta póliza."
          action={
            <Link
              href={`/activity?entity=Policy&id=${id}`}
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
                Sin actividad registrada para esta póliza todavía.
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
