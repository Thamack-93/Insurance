import Link from "next/link";
import {
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  FileText,
  ReceiptText,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { StatusBadge } from "@/components/badges/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { buttonVariants } from "@/components/ui/button";
import { getTodayData } from "@/lib/dashboard-queries";
import { daysSince, daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export default async function TodayPage() {
  const data = await getTodayData();

  const dueTodayCount = data.paymentsDueToday.length;
  const overdueCount = data.overduePayments.length;
  const due7Count = data.paymentsDue7.length;
  const renewalsCount = data.urgentRenewals.length;
  const overdueTasksCount = data.overdueTasks.length;
  const commissionsCount = data.commissionsToReview.length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Hoy"
        title="Qué tienes que hacer hoy"
        description="Una bandeja accionable: cobrar, renovar, resolver pendientes y revisar comisiones. Sin gráficos ni timeline."
        actions={
          <>
            <Link
              href="/receipts?tab=cobrar"
              className={cn(buttonVariants({ variant: "outline" }), "rounded-full bg-card/80")}
            >
              <ReceiptText className="size-4" />
              Cobrar recibos
            </Link>
            <Link href="/tasks/new" className={cn(buttonVariants(), "rounded-full")}>
              <CheckSquare className="size-4" />
              Crear pendiente
            </Link>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard title="Vencidos" value={overdueCount} description="Recibos atrasados" icon={Siren} tone="rose" />
        <MetricCard
          title="Vencen hoy"
          value={dueTodayCount}
          description="Recibos del día"
          icon={ReceiptText}
          tone="amber"
        />
        <MetricCard title="Próx. 7 días" value={due7Count} description="Recibos por cobrar" icon={ReceiptText} tone="emerald" />
        <MetricCard
          title="Renovaciones"
          value={renewalsCount}
          description="Pólizas en 30 días"
          icon={ShieldCheck}
          tone="blue"
        />
        <MetricCard
          title="Pendientes atrasados"
          value={overdueTasksCount}
          description="Tareas fuera de fecha"
          icon={CheckSquare}
          tone="rose"
        />
        <MetricCard
          title="Comisiones"
          value={commissionsCount}
          description="Por revisar pronto"
          icon={CircleDollarSign}
          tone="emerald"
        />
      </section>

      <SectionCard title="Por cobrar" description="Recibos vencidos, los de hoy y los próximos siete días.">
        <div className="space-y-4 p-4">
          <PaymentGroup title="Vencidos" tone="rose" receipts={data.overduePayments} />
          <PaymentGroup title="Vencen hoy" tone="amber" receipts={data.paymentsDueToday} />
          <PaymentGroup title="Vencen en 7 días" tone="emerald" receipts={data.paymentsDue7} />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Renovar" description="Pólizas que vencen pronto.">
          <div className="space-y-3 p-4">
            {data.urgentRenewals.length === 0 ? (
              <EmptyRow icon={CalendarClock} message="Sin renovaciones urgentes." />
            ) : (
              data.urgentRenewals.map((policy) => (
                <Link
                  key={policy.id}
                  href={`/policies/${policy.id}`}
                  className="block rounded-2xl border bg-card/70 p-4 hover:border-primary/20"
                >
                  <p className="font-medium">{policy.policyNumber}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{policy.client.fullName}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Renovación {policy.renewalDate ? formatDate(policy.renewalDate) : "sin fecha"}
                  </p>
                </Link>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Pendientes atrasados" description="Tareas fuera de fecha.">
          <div className="space-y-3 p-4">
            {data.overdueTasks.length === 0 ? (
              <EmptyRow icon={CheckSquare} message="Sin pendientes atrasados." />
            ) : (
              data.overdueTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="block rounded-2xl border bg-card/70 p-4 hover:border-primary/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{task.folio}</p>
                    </div>
                    <StatusBadge status={task.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Inicio hace {daysSince(task.startDate)} días
                  </p>
                </Link>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Comisiones por revisar" description="Esperadas o vencidas en el corto plazo.">
          <div className="space-y-3 p-4">
            {data.commissionsToReview.length === 0 ? (
              <EmptyRow icon={CircleDollarSign} message="Sin comisiones pendientes." />
            ) : (
              data.commissionsToReview.map((commission) => (
                <Link
                  key={commission.id}
                  href="/commissions"
                  className="block rounded-2xl border bg-card/70 p-4 hover:border-primary/20"
                >
                  <p className="font-medium">
                    {formatCurrency(commission.actualAmount ?? commission.expectedAmount)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{commission.client.fullName}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Esperada {formatDate(commission.expectedDate)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function EmptyRow({ icon: Icon, message }: { icon: typeof CalendarClock; message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
      <Icon className="size-4" />
      {message}
    </div>
  );
}

const groupTone = {
  rose: "border-rose-200/70 bg-rose-50/50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300",
  amber: "border-amber-200/70 bg-amber-50/50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
  emerald: "border-emerald-200/70 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
} as const;

function PaymentGroup({
  title,
  tone,
  receipts,
}: {
  title: string;
  tone: keyof typeof groupTone;
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
      <div className={cn("mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", groupTone[tone])}>
        <ReceiptText className="size-3.5" />
        {title}
        <span className="rounded-full bg-card/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {receipts.length}
        </span>
      </div>
      <div className="space-y-2">
        {receipts.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
            Sin recibos en este grupo.
          </div>
        ) : (
          receipts.map((receipt) => (
            <div
              key={receipt.id}
              className="flex flex-col gap-3 rounded-2xl border bg-card/70 p-4 md:flex-row md:items-center md:justify-between"
            >
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
                    {formatDate(receipt.dueDate)} · {daysUntil(receipt.dueDate)} días
                  </p>
                </div>
                <Link
                  href={`/receipts/${receipt.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full bg-card")}
                >
                  <FileText className="size-3.5" />
                  Recibo
                </Link>
                <Link
                  href={`/receipts?tab=cobrar`}
                  className={cn(buttonVariants({ size: "sm" }), "rounded-full")}
                >
                  Cobrar
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
