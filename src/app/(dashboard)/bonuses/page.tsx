import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { formatCurrency, toNumber } from "@/lib/money";
import { withTenantTransaction, requireOrganizationRoleOrRedirect } from "@/lib/organization-context";
import { BONUS_PROGRAMS, resolveBonusProgram } from "@/lib/bonus-rules";
import { bonusPeriodLabel } from "@/lib/bonus-periods";
import { approveBonusRun } from "./actions";
import { ExportButtons } from "@/components/reports/export-buttons";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { commissionNavigation } from "@/lib/navigation";
import { BonusProjectionForm } from "./bonus-projection-form";
import { BonusRunItemsTable } from "./bonus-run-items-table";
import { AutoBonusEvidenceBatchForm } from "./auto-bonus-evidence-batch-form";
import { ChevronDown } from "lucide-react";

function bonusAmountLabel(eligibilityOnly: boolean | undefined, amount: unknown, status: string) {
  if (eligibilityOnly) return "Solo elegibilidad";
  if (amount !== null) return formatCurrency(toNumber(amount), "MXN");
  return status === "READY" ? "Sin banda" : "Pendiente";
}

function bonusRateLabel(eligibilityOnly: boolean | undefined, rate: unknown, status: string) {
  if (eligibilityOnly) return "Solo elegibilidad";
  if (rate !== null) return `${(toNumber(rate) * 100).toFixed(2)}%`;
  return status === "READY" ? "Sin banda" : "Pendiente";
}

export default async function BonusesPage({ searchParams }: { searchParams?: Promise<{ run?: string; autosConfirmed?: string; autosExcluded?: string; autosPendingInventory?: string }> }) {
  await connection();
  const context = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const searchParamsResult = (await searchParams) ?? {};
  const runId = searchParamsResult.run;
  const { sellers, run, recentRuns, retentionStatus, databaseClockRows } = await withTenantTransaction(context, async (db) => {
    const sellers = await db.user.findMany({
      where: { active: true, organizationMemberships: { some: { organizationId: context.organizationId, active: true } } },
      select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
    });
    const run = runId ? await db.bonusRun.findFirst({
      where: { id: runId, organizationId: context.organizationId },
      relationLoadStrategy: "join",
      include: { seller: { select: { name: true } }, approvedBy: { select: { name: true } }, ruleSet: { select: { version: true, sourceFileName: true, sourceHash: true } }, items: { include: { payment: { select: { paidDate: true } }, policy: { select: { policyNumber: true } }, receipt: { select: { receiptNumber: true } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] } },
    }) : null;
    const recentRuns = await db.bonusRun.findMany({ where: { organizationId: context.organizationId }, relationLoadStrategy: "join", include: { seller: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 12 });
    const retentionStatus = await db.maintenanceRun.findFirst({ where: { organizationId: context.organizationId, type: "BONUS_RUN_RETENTION" }, orderBy: { completedAt: "desc" } });
    const databaseClockRows = await db.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    return { sellers, run, recentRuns, retentionStatus, databaseClockRows };
  });
  if (runId && !run) notFound();
  const program = run ? resolveBonusProgram(run.programKey) : null;
  let snapshot: { input?: { damagePortfolioLossRatio?: number | null; damagePortfolioLossRatioAsOf?: string | null; damagePortfolioLossRatioSource?: string | null }; projection?: { reviewReasons?: string[]; eligibilityOutcome?: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_EVIDENCE"; items?: Array<{ evidence?: Record<string, unknown> }> } } = {};
  if (run) {
    try { snapshot = JSON.parse(run.snapshotJson) as typeof snapshot; } catch { snapshot = {}; }
  }
  const latestRun = recentRuns[0];
  const latestProgram = latestRun ? resolveBonusProgram(latestRun.programKey) : null;
  const retentionSummary = (() => {
    try { return retentionStatus?.summaryJson ? JSON.parse(retentionStatus.summaryJson) as { durationMs?: number; purged?: number; failedOrganizations?: number; moreExpired?: boolean; retentionDays?: number } : null; }
    catch { return null; }
  })();
  const retentionLabel = retentionStatus?.status === "COMPLETED" ? "Correcta" : retentionStatus?.status === "PARTIAL" ? "Parcial" : retentionStatus?.status === "FAILED" ? "Con error" : "Sin ejecución registrada";
  const runExpiration = (updatedAt: Date) => new Date(updatedAt.getTime() + 5 * 24 * 60 * 60 * 1000);
  const databaseNow = databaseClockRows[0].now;
  const remainingDays = (expiresAt: Date) => Math.max(0, Math.ceil((expiresAt.getTime() - databaseNow.getTime()) / (24 * 60 * 60 * 1000)));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader eyebrow="Finanzas" title="Bonos e incentivos" description="Proyecta los bonos 2026 de Autos y Daños por vendedor, revisa cada pago y guarda cierres reproducibles." />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LocalNavigation items={commissionNavigation} label="Comisiones y bonos" variant="compact" />
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><span className="font-medium">Retención automática:</span> {retentionLabel} · corridas y cierres se eliminan 5 días después de su última actualización.</p>
            {retentionStatus?.completedAt ? <span className="text-xs text-muted-foreground">Último ciclo: {retentionStatus.completedAt.toLocaleString("es-MX")}{retentionSummary?.durationMs !== undefined ? ` · ${(retentionSummary.durationMs / 1000).toFixed(1)} s` : ""}{retentionSummary?.purged !== undefined ? ` · ${retentionSummary.purged} eliminadas` : ""}{retentionSummary?.failedOrganizations ? ` · ${retentionSummary.failedOrganizations} organización(es) con error` : ""}{retentionSummary?.moreExpired ? " · quedan corridas por procesar" : ""}</span> : null}
          </div>
          {retentionStatus && retentionStatus.status !== "COMPLETED" ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">El último ciclo quedó incompleto o con errores; revisa los logs del job `bonus-run-retention` en Vercel.</p> : null}
        </div>
        <SectionCard title="Nueva proyección" description="Elige el programa y el corte que corresponda. Los datos faltantes se marcarán para revisión antes de aprobar.">
          <div className="p-4 sm:p-5 lg:p-6">
          <BonusProjectionForm
            programs={BONUS_PROGRAMS.map(({ key, label, period, accumulation }) => ({ key, label, period, accumulation }))}
            sellers={sellers}
            initialProgramKey={program?.key ?? BONUS_PROGRAMS[0].key}
            initialSellerId={run?.sellerId ?? sellers[0]?.id ?? ""}
            initialPeriodNumber={run?.periodNumber ?? 1}
            initialLossRatio={run?.programKey.startsWith("DAMAGE_") && snapshot.input?.damagePortfolioLossRatio !== null && snapshot.input?.damagePortfolioLossRatio !== undefined ? String(snapshot.input.damagePortfolioLossRatio * 100) : ""}
            initialLossRatioAsOf={snapshot.input?.damagePortfolioLossRatioAsOf ?? ""}
            initialLossRatioSource={snapshot.input?.damagePortfolioLossRatioSource ?? ""}
          />
          </div>
        </SectionCard>

        {searchParamsResult.autosConfirmed !== undefined ? <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">Evidencia de Autos guardada para {Number(searchParamsResult.autosConfirmed) || 0} pólizas; {Number(searchParamsResult.autosExcluded) || 0} con 50 vehículos o más quedaron excluidas y {Number(searchParamsResult.autosPendingInventory) || 0} sin conteo respaldado siguen pendientes de revisión.</p> : null}
        <AutoBonusEvidenceBatchForm sellers={sellers} />

      <SectionCard title="Proyecciones y cierres recientes" description="Todas las corridas, incluidos los cierres aprobados, se eliminan automáticamente cinco días después de su última actualización.">
        {recentRuns.length ? <details className="group" open={Boolean(runId)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-b-xl px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium"><span>{recentRuns.length} proyecciones guardadas</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Más reciente</span></span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{latestRun ? `${latestProgram?.label ?? latestRun.programKey} · ${latestRun.seller.name} · ${latestRun.year} · ${latestProgram ? bonusPeriodLabel(latestProgram, latestRun.periodNumber) : "Periodo guardado"}` : ""}</span>
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y border-t">
          {recentRuns.map((recent) => {
          const recentProgram = resolveBonusProgram(recent.programKey);
          const statusLabel = recent.status === "APPROVED" ? "Aprobado" : recent.status === "READY" ? "Listo para aprobar" : "Pendiente de revisión";
          return <Link key={recent.id} href={`/bonuses?run=${encodeURIComponent(recent.id)}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40">
            <span className="min-w-0"><span className="block font-medium">{recentProgram?.label ?? recent.programKey} · {recent.seller.name}</span><span className="mt-1 block text-xs text-muted-foreground">{recent.year} · {recentProgram ? bonusPeriodLabel(recentProgram, recent.periodNumber) : recent.periodType === "ANNUAL" ? "Anual" : `T${recent.periodNumber}`} · Se elimina en {remainingDays(runExpiration(recent.updatedAt))} días</span></span>
            <span className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${recent.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : recent.status === "READY" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>{statusLabel}</span><span className="font-medium tabular-nums">{bonusAmountLabel(recentProgram?.eligibilityOnly, recent.bonusAmount, recent.status)}</span></span>
          </Link>;
        })}
          </div>
        </details> : <p className="p-6 text-center text-sm text-muted-foreground">Aún no hay proyecciones guardadas.</p>}
      </SectionCard>

        {run && program ? (
        <SectionCard title={`${program.label} · ${run.seller.name}`} description={`2026 · ${bonusPeriodLabel(program, run.periodNumber)} · Estado: ${run.status === "APPROVED" ? "Aprobado" : run.status === "READY" ? "Listo para aprobar" : "Pendiente de revisión"}`} action={<div className="flex flex-wrap gap-2"><ExportButtons exports={[{ name: "Resumen del cierre", data: [{
          "Programa": program.label,
          "Vendedor": run.seller.name,
          "Año": run.year,
          "Periodo": bonusPeriodLabel(program, run.periodNumber),
          "Estado": run.status,
          "Prima neta computable MXN": toNumber(run.baseAmount).toFixed(2),
          "Tasa": run.bonusRate === null ? "" : `${(toNumber(run.bonusRate) * 100).toFixed(2)}%`,
          "Bono MXN": run.bonusAmount === null ? "" : toNumber(run.bonusAmount).toFixed(2),
          "Aprobado por": run.approvedBy?.name ?? "",
          "Fecha de aprobación": run.approvedAt?.toISOString() ?? "",
          "Versión de cálculo": run.version,
          "Versión de reglas": run.ruleSet.version,
          "Archivo fuente": run.ruleSet.sourceFileName,
          "SHA-256": run.ruleSet.sourceHash,
          "Datos de entrada": JSON.stringify(snapshot.input ?? {}),
          "Motivos de revisión": (snapshot.projection?.reviewReasons ?? []).join(" | "),
        }] }, { name: "Detalle de bono", data: run.items.map((item) => ({
          "Estado": item.status === "INCLUDED" ? "Incluida" : item.status === "EXCLUDED" ? "Excluida" : "Revisión",
          "Fecha de pago": item.payment?.paidDate?.toISOString().slice(0, 10) ?? "",
          "Recibo": item.receipt?.receiptNumber ?? "",
          "Póliza": item.policy?.policyNumber ?? "",
          "Importe pagado": item.paidAmount === null ? "" : toNumber(item.paidAmount).toFixed(2),
          "Prima neta pagada": item.netPremiumPaid === null ? "" : toNumber(item.netPremiumPaid).toFixed(2),
          "Importe elegible MXN": item.eligibleAmount === null ? "" : toNumber(item.eligibleAmount).toFixed(2),
          "Moneda": item.currency ?? "MXN",
          "Motivo": item.reason ?? "Criterios documentados",
          "Evidencia usada": item.evidenceJson,
        })) }]} /><a href={`/api/bonuses/${encodeURIComponent(run.id)}/snapshot`} className="inline-flex h-9 items-center rounded-md border bg-card/70 px-3 text-sm font-medium hover:bg-muted">Snapshot JSON</a></div>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Prima neta computable (MXN)</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(toNumber(run.baseAmount), "MXN")}</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Tasa estimada</p><p className="mt-1 text-xl font-semibold tabular-nums">{bonusRateLabel(program.eligibilityOnly, run.bonusRate, run.status)}</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Bono estimado</p><p className="mt-1 text-xl font-semibold tabular-nums">{bonusAmountLabel(program.eligibilityOnly, run.bonusAmount, run.status)}</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Este corte se eliminará automáticamente el {runExpiration(run.updatedAt).toLocaleString("es-MX")} (5 días después de su última actualización). Descarga el detalle antes de esa fecha si necesitas conservarlo.</p>
          {program.eligibilityOnly ? <p className="mt-3 rounded-lg border p-3 text-sm">Estatus de elegibilidad: <strong>{snapshot.projection?.eligibilityOutcome === "ELIGIBLE" ? "Cumple los requisitos documentados" : snapshot.projection?.eligibilityOutcome === "NOT_ELIGIBLE" ? "No alcanza el requisito de prima neta total de $4,200,000" : "Pendiente de evidencia"}</strong></p> : null}
          {snapshot.projection?.reviewReasons?.length ? <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"><p className="font-medium">Pendiente de revisión</p><ul className="mt-2 list-disc pl-5 text-sm">{snapshot.projection.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div> : null}
          <BonusRunItemsTable items={run.items.map((item) => ({
            id: item.id,
            status: item.status === "INCLUDED" ? ("INCLUDED" as const) : item.status === "EXCLUDED" ? ("EXCLUDED" as const) : ("REVIEW" as const),
            paymentReference: item.paymentId?.slice(-8) ?? "—",
            receiptPolicy: `${item.receipt?.receiptNumber ?? "—"} / ${item.policy?.policyNumber ?? "—"}`,
            paidDate: item.payment?.paidDate?.toLocaleDateString("es-MX") ?? "—",
            paidAmount: item.paidAmount === null ? "—" : formatCurrency(toNumber(item.paidAmount), item.currency ?? "MXN"),
            netPremiumPaid: item.netPremiumPaid === null ? "—" : formatCurrency(toNumber(item.netPremiumPaid), item.currency ?? "MXN"),
            eligibleAmount: item.eligibleAmount === null ? "—" : formatCurrency(toNumber(item.eligibleAmount), "MXN"),
            reason: item.reason ?? "Criterios documentados",
            evidenceJson: item.evidenceJson,
          }))} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p>{run.status === "APPROVED" ? `Aprobado por ${run.approvedBy?.name ?? "administración"} el ${run.approvedAt?.toLocaleDateString("es-MX")}.` : `Versión de cálculo ${run.version}.`} Reglas v{run.ruleSet.version} · {run.ruleSet.sourceFileName} · SHA-256 {run.ruleSet.sourceHash.slice(0, 12)}…</p>
            {run.status !== "APPROVED" ? <form action={approveBonusRun} className="flex flex-col items-start gap-2 sm:items-end"><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="version" value={run.version} /><label className="flex max-w-md items-start gap-2 text-xs text-muted-foreground"><input required type="checkbox" name="reviewAttestation" className="mt-0.5 accent-primary" disabled={run.status !== "READY" || run.items.some((item) => item.status === "REVIEW")} /><span>Confirmo que revisé las partidas, exclusiones, evidencias, periodo y monto de este cierre.</span></label><Button type="submit" disabled={run.status !== "READY" || run.items.some((item) => item.status === "REVIEW")}>Aprobar cierre</Button></form> : null}
          </div>
        </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
