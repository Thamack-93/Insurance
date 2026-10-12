import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatCurrencyExact } from "@/lib/money";
import { formatPremiumPercent, type RenewalComparison, type RenewalComparisonEntry } from "@/lib/policy-renewal-comparison";

const statusLabels = {
  CHANGED: "Cambió",
  ADDED: "Agregado",
  REMOVED: "Retirado",
} as const;

function ComparisonRows({ entries }: { entries: RenewalComparisonEntry[] }) {
  if (!entries.length) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Sin cambios relevantes para este ramo.</p>;
  }

  return (
    <ul className="divide-y divide-border/70">
      {entries.map((entry) => (
        <li key={entry.key} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1fr)] sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-foreground">{entry.label}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{statusLabels[entry.status as keyof typeof statusLabels]}</span>
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
  const { previous, renewal } = comparison.premiums;
  const previousPremium = previous ? formatCurrencyExact(previous.amount, previous.currency ?? undefined) : null;
  const renewalPremium = renewal ? formatCurrencyExact(renewal.amount, renewal.currency ?? undefined) : null;
  const premiumDifference = comparison.premiumDifference;
  const premiumDescription = premiumDifference
    ? `Diferencia: ${premiumDifference.amount > 0 ? "+" : premiumDifference.amount < 0 ? "−" : ""}${formatCurrencyExact(premiumDifference.absoluteAmount, premiumDifference.currency)} (${formatPremiumPercent(premiumDifference.percent)}).`
    : previous && renewal && previous.currency !== renewal.currency
      ? "Las monedas son distintas; no se calcula una variación."
      : previous && renewal && previous.amount === 0
        ? "No se calcula una variación porcentual porque la prima anterior era cero."
        : null;

  return (
    <details className="group rounded-2xl border border-border/70 bg-card shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden sm:px-5">
        <span>Comparar con póliza anterior</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Comparación de renovación</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Anterior: <Link href={previousPolicyHref} className="font-medium text-primary underline-offset-4 hover:underline">{previousPolicyNumber}</Link>
            </p>
          </div>
          <Link href={editHref} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">Editar renovación</Link>
        </div>

        {previousPremium || renewalPremium ? (
          <div className="mt-4 rounded-xl bg-muted/30 px-4 py-3 text-sm text-foreground">
            <p><span className="font-medium">Prima:</span> {previousPremium ?? "Sin dato"} <span aria-hidden="true">→</span> {renewalPremium ?? "Sin dato"}</p>
            {premiumDescription ? <p className="mt-1 text-muted-foreground">{premiumDescription}</p> : null}
          </div>
        ) : null}

        {comparison.policyTypeChanged ? (
          <p className="mt-4 rounded-xl border border-border/70 px-4 py-3 text-sm text-muted-foreground">
            El ramo cambió entre pólizas; los campos específicos no son comparables.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
            <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground">Cambios relevantes del ramo</h3>
            <ComparisonRows entries={comparison.differences} />
          </div>
        )}
      </div>
    </details>
  );
}
