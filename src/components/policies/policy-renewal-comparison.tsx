import Link from "next/link";
import { formatCurrencyExact } from "@/lib/money";
import { formatPremiumPercent, type RenewalComparison, type RenewalComparisonEntry } from "@/lib/policy-renewal-comparison";

const statusLabels = {
  UNCHANGED: "Sin cambio",
  CHANGED: "Cambió",
  ADDED: "Agregado",
  REMOVED: "Retirado",
  MISSING: "Información incompleta",
} as const;

function ComparisonRows({ entries }: { entries: RenewalComparisonEntry[] }) {
  if (!entries.length) return <p className="px-4 py-3 text-sm text-muted-foreground">No hay datos para comparar en esta sección.</p>;
  return (
    <ul className="divide-y divide-border/70">
      {entries.map((entry) => (
        <li key={entry.key} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1fr)] sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-foreground">{entry.label}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{statusLabels[entry.status]}</span>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <p className="min-w-0 break-words text-sm text-muted-foreground"><span className="mr-1 font-medium text-foreground">Anterior:</span>{entry.oldValue ?? "Sin dato"}</p>
            <p className="min-w-0 break-words text-sm text-muted-foreground"><span className="mr-1 font-medium text-foreground">Renovación:</span>{entry.newValue ?? "Sin dato"}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PolicyRenewalComparison({
  comparison,
  previousPolicyNumber,
  previousPolicyHref,
  editHref,
}: {
  comparison: RenewalComparison;
  previousPolicyNumber: string;
  previousPolicyHref: string;
  editHref: string;
}) {
  const { counts } = comparison;
  const differenceCount = counts.CHANGED + counts.ADDED + counts.REMOVED;
  const premium = comparison.premiumDifference;
  const premiumPercent = premium ? formatPremiumPercent(premium.percent) : null;
  return (
    <section aria-labelledby="renewal-comparison-title" className="rounded-3xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 id="renewal-comparison-title" className="text-lg font-semibold text-foreground">Comparación con póliza anterior</h2>
          <p className="mt-1 text-sm text-muted-foreground">Renovación comparada con <Link href={previousPolicyHref} className="font-medium text-primary underline-offset-4 hover:underline">{previousPolicyNumber}</Link></p>
          <p className="mt-2 text-sm text-muted-foreground">
            {differenceCount} cambio(s) · {counts.UNCHANGED} dato(s) sin cambio
            {counts.MISSING > 0 ? ` · ${counts.MISSING} dato(s) faltante(s)` : ""}
          </p>
        </div>
        <Link href={editHref} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">Editar renovación</Link>
      </div>
      {premium ? (
        <p className="border-b border-border/70 bg-muted/20 px-4 py-3 text-sm text-foreground sm:px-5">
          Diferencia de prima: {premium.amount > 0 ? "+" : premium.amount < 0 ? "−" : ""}{formatCurrencyExact(premium.absoluteAmount, premium.currency)} ({premiumPercent}).
        </p>
      ) : null}
      {comparison.legacyPreviousText ? (
        <div className="border-b border-border/70 px-4 py-3 sm:px-5">
          <p className="text-sm font-medium text-foreground">Información anterior no estructurada</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{comparison.legacyPreviousText}</p>
        </div>
      ) : null}
      <div className="p-3 sm:p-4">
        <div className="overflow-hidden rounded-2xl border border-border/70">
          <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground">Diferencias</h3>
          <ComparisonRows entries={comparison.differences} />
        </div>
        <details className="mt-3 overflow-hidden rounded-2xl border border-border/70">
          <summary className="cursor-pointer list-none bg-muted/30 px-4 py-3 text-sm font-medium text-foreground">Ver datos sin cambio ({comparison.unchanged.length})</summary>
          <ComparisonRows entries={comparison.unchanged} />
        </details>
      </div>
    </section>
  );
}
