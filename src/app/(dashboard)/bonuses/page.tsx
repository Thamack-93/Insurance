import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, toNumber } from "@/lib/money";
import { withTenantTransaction, requireOrganizationRoleOrRedirect } from "@/lib/organization-context";
import { BONUS_PROGRAMS, resolveBonusProgram } from "@/lib/bonus-rules";
import { approveBonusRun, previewBonus } from "./actions";
import { ExportButtons } from "@/components/reports/export-buttons";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { commissionNavigation } from "@/lib/navigation";

function prettyEvidence(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

export default async function BonusesPage({ searchParams }: { searchParams?: Promise<{ run?: string }> }) {
  await connection();
  const context = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const runId = (await searchParams)?.run;
  const [sellers, run, recentRuns] = await withTenantTransaction(context, async (db) => Promise.all([
    db.user.findMany({
      where: { active: true, organizationMemberships: { some: { organizationId: context.organizationId, active: true } } },
      select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
    }),
    runId ? db.bonusRun.findFirst({
      where: { id: runId, organizationId: context.organizationId },
      include: { seller: { select: { name: true } }, approvedBy: { select: { name: true } }, ruleSet: { select: { version: true, sourceFileName: true, sourceHash: true } }, items: { include: { payment: { select: { paidDate: true } }, policy: { select: { policyNumber: true } }, receipt: { select: { receiptNumber: true } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] } },
    }) : null,
    db.bonusRun.findMany({ where: { organizationId: context.organizationId }, include: { seller: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 12 }),
  ]));
  if (runId && !run) notFound();
  const program = run ? resolveBonusProgram(run.programKey) : null;
  let snapshot: { input?: { damagePortfolioLossRatio?: number | null }; projection?: { reviewReasons?: string[]; eligibilityOutcome?: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_EVIDENCE"; items?: Array<{ evidence?: Record<string, unknown> }> } } = {};
  if (run) {
    try { snapshot = JSON.parse(run.snapshotJson) as typeof snapshot; } catch { snapshot = {}; }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Finanzas" title="Bonos e incentivos" description="Proyecta los bonos 2026 de Autos y Daños por vendedor, revisa cada pago y guarda cierres reproducibles." />
      <LocalNavigation items={commissionNavigation} label="Comisiones y bonos" />
      <SectionCard title="Nueva proyección" description="Solo se consideran pagos POSTED; los pagos revertidos quedan fuera. Los programas con datos faltantes permanecen en revisión.">
        <form action={previewBonus} className="grid gap-4 md:grid-cols-5">
          <label className="grid gap-1 text-sm">Programa<select name="programKey" defaultValue={program?.key ?? BONUS_PROGRAMS[0].key} className="h-10 rounded-md border bg-background px-3">
            {BONUS_PROGRAMS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm">Vendedor<select required name="sellerId" defaultValue={run?.sellerId ?? sellers[0]?.id ?? ""} className="h-10 rounded-md border bg-background px-3">
            {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} · {seller.email}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm">Año<select name="year" defaultValue="2026" className="h-10 rounded-md border bg-background px-3"><option value="2026">2026</option></select></label>
          <label className="grid gap-1 text-sm">Trimestre<select name="periodNumber" defaultValue={String(run?.periodNumber ?? 1)} className="h-10 rounded-md border bg-background px-3"><option value="1">1.º trimestre / anual</option><option value="2">2.º trimestre</option><option value="3">3.º trimestre</option><option value="4">4.º trimestre</option></select></label>
          <label className="grid gap-1 text-sm">Siniestralidad total de cartera Daños (%) · solo Daños<input name="damagePortfolioLossRatio" type="number" min="0" max="100" step="0.00000001" placeholder="Dato del cierre de Daños" defaultValue={run?.programKey.startsWith("DAMAGE_") && snapshot.input?.damagePortfolioLossRatio !== null && snapshot.input?.damagePortfolioLossRatio !== undefined ? String(snapshot.input.damagePortfolioLossRatio * 100) : ""} className="h-10 rounded-md border bg-background px-3" /></label>
          <div className="flex items-end"><Button type="submit" disabled={!sellers.length}>Calcular proyección</Button></div>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">Autos acumula desde enero hasta el trimestre seleccionado. Daños Banorte/HDI/Zurich usa el trimestre; Chubb usa el año calendario. Para Daños se debe indicar la siniestralidad total de la cartera del vendedor en el periodo, considerando todas las aseguradoras; sin ese dato, el cierre queda pendiente de revisión.</p>
      </SectionCard>

      <SectionCard title="Cierres recientes" description="Proyecciones y cierres aprobados guardados para esta organización.">
        {recentRuns.length ? <div className="divide-y rounded-lg border">{recentRuns.map((recent) => {
          const recentProgram = resolveBonusProgram(recent.programKey);
          return <Link key={recent.id} href={`/bonuses?run=${encodeURIComponent(recent.id)}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40">
            <span className="font-medium">{recentProgram?.label ?? recent.programKey} · {recent.seller.name} · {recent.year}{recent.periodType === "QUARTERLY" ? ` · T${recent.periodNumber}` : ""}</span>
            <span>{recent.status} · {recent.bonusAmount === null ? "Elegibilidad / sin importe" : formatCurrency(toNumber(recent.bonusAmount), "MXN")}</span>
          </Link>;
        })}</div> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aún no hay proyecciones guardadas.</p>}
      </SectionCard>

      {run && program ? (
        <SectionCard title={`${program.label} · ${run.seller.name}`} description={`2026 · ${run.periodType === "QUARTERLY" ? `Trimestre ${run.periodNumber}` : "Cierre anual / primer año"} · Estado: ${run.status}`} action={<ExportButtons exports={[{ name: "Detalle de bono", data: run.items.map((item) => ({
          "Estado": item.status === "INCLUDED" ? "Incluida" : item.status === "EXCLUDED" ? "Excluida" : "Revisión",
          "Fecha de pago": item.payment?.paidDate?.toISOString().slice(0, 10) ?? "",
          "Recibo": item.receipt?.receiptNumber ?? "",
          "Póliza": item.policy?.policyNumber ?? "",
          "Importe pagado": item.paidAmount === null ? "" : toNumber(item.paidAmount).toFixed(2),
          "Prima neta pagada": item.netPremiumPaid === null ? "" : toNumber(item.netPremiumPaid).toFixed(2),
          "Importe elegible MXN": item.eligibleAmount === null ? "" : toNumber(item.eligibleAmount).toFixed(2),
          "Moneda": item.currency ?? "MXN",
          "Motivo": item.reason ?? "Criterios documentados",
        })) }]} />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Prima neta computable (MXN)</p><p className="text-xl font-semibold">{formatCurrency(toNumber(run.baseAmount), "MXN")}</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Tasa estimada</p><p className="text-xl font-semibold">{run.bonusRate === null ? "Elegibilidad" : `${(toNumber(run.bonusRate) * 100).toFixed(2)}%`}</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Bono estimado</p><p className="text-xl font-semibold">{run.bonusAmount === null ? "—" : formatCurrency(toNumber(run.bonusAmount), "MXN")}</p></div>
          </div>
          {program.eligibilityOnly ? <p className="mt-3 rounded-lg border p-3 text-sm">Estatus de elegibilidad: <strong>{snapshot.projection?.eligibilityOutcome === "ELIGIBLE" ? "Cumple los requisitos documentados" : snapshot.projection?.eligibilityOutcome === "NOT_ELIGIBLE" ? "No alcanza el requisito de prima neta total de $4,200,000" : "Pendiente de evidencia"}</strong></p> : null}
          {snapshot.projection?.reviewReasons?.length ? <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"><p className="font-medium">Pendiente de revisión</p><ul className="mt-2 list-disc pl-5 text-sm">{snapshot.projection.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div> : null}
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Estado</TableHead><TableHead>Pago</TableHead><TableHead>Recibo / póliza</TableHead><TableHead>Fecha</TableHead><TableHead>Pagado</TableHead><TableHead>PNP asignada</TableHead><TableHead>Elegible MXN</TableHead><TableHead>Motivo / evidencia</TableHead></TableRow></TableHeader>
              <TableBody>
                {run.items.length ? run.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.status === "INCLUDED" ? "Incluida" : item.status === "EXCLUDED" ? "Excluida" : "Revisión"}</TableCell>
                    <TableCell className="font-mono text-xs">{item.paymentId?.slice(-8) ?? "—"}</TableCell>
                    <TableCell>{item.receipt?.receiptNumber ?? "—"} / {item.policy?.policyNumber ?? "—"}</TableCell>
                    <TableCell>{item.payment?.paidDate?.toLocaleDateString("es-MX") ?? "—"}</TableCell>
                    <TableCell>{item.paidAmount === null ? "—" : formatCurrency(toNumber(item.paidAmount), item.currency ?? "MXN")}</TableCell>
                    <TableCell>{item.netPremiumPaid === null ? "—" : formatCurrency(toNumber(item.netPremiumPaid), item.currency ?? "MXN")}</TableCell>
                    <TableCell>{item.eligibleAmount === null ? "—" : formatCurrency(toNumber(item.eligibleAmount), "MXN")}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal text-xs"><span>{item.reason ?? "Criterios documentados"}</span>{item.evidenceJson ? <details className="mt-1"><summary className="cursor-pointer text-primary">Ver evidencia</summary><pre className="mt-1 max-w-sm whitespace-pre-wrap break-all text-[10px]">{prettyEvidence(item.evidenceJson)}</pre></details> : null}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No hay pagos que coincidan con el programa, vendedor y periodo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p>{run.status === "APPROVED" ? `Aprobado por ${run.approvedBy?.name ?? "administración"} el ${run.approvedAt?.toLocaleDateString("es-MX")}.` : `Versión de cálculo ${run.version}.`} Reglas v{run.ruleSet.version} · {run.ruleSet.sourceFileName} · SHA-256 {run.ruleSet.sourceHash.slice(0, 12)}…</p>
            {run.status !== "APPROVED" ? <form action={approveBonusRun}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="version" value={run.version} /><Button type="submit" disabled={run.status !== "READY" || run.items.some((item) => item.status === "REVIEW")}>Aprobar cierre</Button></form> : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
