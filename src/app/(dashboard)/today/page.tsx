import Link from "next/link";
import {
  CheckCircle2,
  ClipboardPlus,
  Contact,
  FileText,
  FolderOpen,
  PhoneCall,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { QuickActionButton } from "@/components/actions/quick-action-button";
import { RiskAlertCard } from "@/components/cards/risk-alert-card";
import { StatusBadge } from "@/components/badges/status-badge";
import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getTodayData } from "@/lib/dashboard-queries";
import { daysSince, daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export default async function TodayPage() {
  const data = await getTodayData();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Hoy"
        title="Que tienes que hacer hoy"
        description="Una bandeja operativa con pagos vencidos, renovaciones urgentes, clientes por contactar, comisiones y riesgos criticos."
        actions={
          <>
            <QuickActionButton icon={PhoneCall} label="Marcar seguimiento" />
            <QuickActionButton icon={ClipboardPlus} label="Crear pendiente" />
            <QuickActionButton icon={CheckCircle2} label="Marcar recibo pagado" />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Pagos que requieren accion" description="Vencidos, de hoy y de los proximos 7 dias." />
          </CardHeader>
          <CardContent className="space-y-4">
            <PaymentGroup title="Vencidos" receipts={data.overduePayments} />
            <PaymentGroup title="Vencen hoy" receipts={data.paymentsDueToday} />
            <PaymentGroup title="Vencen en 7 dias" receipts={data.paymentsDue7} />
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Acciones rapidas" description="Atajos para operar sin perder contexto." />
          </CardHeader>
          <CardContent className="grid gap-2">
            <Link href="/tasks" className={cn(buttonVariants({ variant: "outline" }), "justify-start rounded-2xl bg-white/70")}>
              <ClipboardPlus className="size-4" />
              Crear pendiente
            </Link>
            <Link href="/policies" className={cn(buttonVariants({ variant: "outline" }), "justify-start rounded-2xl bg-white/70")}>
              <ShieldCheck className="size-4" />
              Ver poliza
            </Link>
            <Link href="/clients" className={cn(buttonVariants({ variant: "outline" }), "justify-start rounded-2xl bg-white/70")}>
              <Contact className="size-4" />
              Ver cliente
            </Link>
            <Link href="/documents" className={cn(buttonVariants({ variant: "outline" }), "justify-start rounded-2xl bg-white/70")}>
              <FolderOpen className="size-4" />
              Ver documentos
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Renovaciones urgentes" description="Polizas que vencen pronto." />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.urgentRenewals.map((policy) => (
              <Link key={policy.id} href={`/policies/${policy.id}`} className="block rounded-2xl border bg-white/70 p-4 hover:border-primary/20">
                <p className="font-medium">{policy.policyNumber}</p>
                <p className="mt-1 text-sm text-muted-foreground">{policy.client.fullName}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Renovacion {policy.renewalDate ? formatDate(policy.renewalDate) : "sin fecha"}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Pendientes atrasados" description="Tareas fuera de fecha." />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.overdueTasks.map((task) => (
              <Link key={task.id} href="/tasks" className="block rounded-2xl border bg-white/70 p-4 hover:border-primary/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{task.folio}</p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Inicio hace {daysSince(task.startDate)} dias</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Comisiones por revisar" description="Esperadas o vencidas en el corto plazo." />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.commissionsToReview.map((commission) => (
              <Link key={commission.id} href="/commissions" className="block rounded-2xl border bg-white/70 p-4 hover:border-primary/20">
                <p className="font-medium">{formatCurrency(commission.actualAmount ?? commission.expectedAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{commission.client.fullName}</p>
                <p className="mt-2 text-xs text-muted-foreground">Esperada {formatDate(commission.expectedDate)}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Riesgos criticos" description="Alertas deterministicas que conviene resolver primero." />
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {data.criticalRisks.map((risk) => (
              <RiskAlertCard
                key={`${risk.alertType}-${risk.entityId}`}
                title={risk.title}
                description={risk.description}
                severity={risk.severity}
                action={risk.suggestedAction}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Ultimos movimientos" />
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={data.recentActivity} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
        <CardHeader>
          <SectionHeader title="Documentos faltantes" description="Huecos documentales que aumentan riesgo operativo." />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.documentsMissing.map((risk) => (
            <RiskAlertCard
              key={`${risk.alertType}-${risk.entityId}`}
              title={risk.title}
              description={risk.description}
              severity={risk.severity}
              action={risk.suggestedAction}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentGroup({
  title,
  receipts,
}: {
  title: string;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    dueDate: Date;
    amount: unknown;
    currency: string;
    client: { fullName: string };
    policy: { id: string; policyNumber: string };
    insurer: { name: string };
  }>;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <ReceiptText className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {receipts.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white/50 p-4 text-sm text-muted-foreground">
            No hay recibos en esta categoria.
          </div>
        ) : (
          receipts.map((receipt) => (
            <div key={receipt.id} className="flex flex-col gap-3 rounded-2xl border bg-white/70 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium">{receipt.client.fullName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {receipt.policy.policyNumber} · {receipt.receiptNumber} · {receipt.insurer.name}
                </p>
              </div>
              <div className="flex items-center gap-3 md:text-right">
                <div>
                  <p className="font-semibold">{formatCurrency(receipt.amount, receipt.currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(receipt.dueDate)} · {daysUntil(receipt.dueDate)} dias
                  </p>
                </div>
                <Link href={`/policies/${receipt.policy.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full bg-white")}>
                  <FileText className="size-3.5" />
                  Poliza
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
