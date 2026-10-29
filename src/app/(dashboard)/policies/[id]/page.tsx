import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { decodeRouteIdentifier } from "@/lib/route-identifier";
import { RecordPageView } from "@/components/recently-viewed/record-page-view";
import { ArrowLeft, ChevronDown, Pencil, Plus } from "lucide-react";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";
import { PageHeader } from "@/components/layout/page-header";
import { NoraContextButton } from "@/components/assistant/nora-session-provider";
import { AuditByline } from "@/components/audit/audit-byline";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocumentDropZone } from "@/components/documents/document-drop-zone";
import { DocumentList } from "@/components/documents/document-list";
import { PolicyReceiptsTable } from "@/components/policies/policy-receipts-table";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { policyOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import { getPolicyFamilyPolicies } from "@/lib/policy-families";
import { policyTypeLabel } from "@/lib/status";
import { countWorkItems, getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { normalizeReturnTo } from "@/lib/return-to";
import { compareRenewalPolicies } from "@/lib/policy-renewal-comparison";
import { PolicyRenewalComparison } from "@/components/policies/policy-renewal-comparison";
import { PolicyRiskOverview } from "@/components/policies/policy-risk-overview";
import { reconcileEndorsementReceiptPremium, reconcilePolicyReceiptPremium } from "@/lib/premium-breakdown";

const frequencyLabels: Record<string, string> = {
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  SINGLE: "Única",
  OTHER: "Otra",
};

function PolicyDisclosure({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold text-foreground">{title}</span>
          <span className="mt-1 block truncate text-sm text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70">{children}</div>
    </details>
  );
}

export default async function PolicyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const routeParams = await params;
  const id = decodeRouteIdentifier(routeParams.id);
  if (!id) notFound();
  const query = (await searchParams) ?? {};
  const returnTo = normalizeReturnTo(typeof query.returnTo === "string" ? query.returnTo : undefined, "/policies");
  const scope = await requireOrganizationPortfolioReadScope();
  const isAdmin = scope.membershipRole !== "AGENT";
  return withTenantOrganization(scope.organizationId, async (db) => {
  const policy = await db.policy.findFirst({
    where: { id, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
    include: {
      client: true,
      insurer: true,
      renewals: {
        where: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        select: {
          id: true,
          policyNumber: true,
        },
        orderBy: { updatedAt: "desc" },
      },
      insuredParties: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      insuredAssets: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!policy) {
    notFound();
  }

  // Re-read the linked source through the same organization and portfolio predicate.
  // A malformed cross-organization relation is deliberately treated as unavailable.
  const previousPolicy = policy.renewedFromPolicyId
    ? await db.policy.findFirst({
        where: { id: policy.renewedFromPolicyId, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      })
    : null;
  const renewalComparison = previousPolicy
    ? compareRenewalPolicies({
        policyType: previousPolicy.policyType,
        premiumAmount: Number(previousPolicy.premiumAmount),
        currency: previousPolicy.currency,
        riskDetails: previousPolicy.riskDetails,
      }, {
        policyType: policy.policyType,
        premiumAmount: Number(policy.premiumAmount),
        currency: policy.currency,
        riskDetails: policy.riskDetails,
      })
    : null;

  const [
    receipts,
    payments,
    workItems,
    documents,
    endorsements,
    activity,
    family,
  ] = await Promise.all([
    db.receipt.findMany({
      where: { policyId: id, organizationId: scope.organizationId, endorsementId: null },
      include: {
        client: true,
        insurer: true,
        endorsement: true,
        payments: { where: { organizationId: scope.organizationId, status: "POSTED" }, select: { id: true } },
      },
      orderBy: [
        { periodStartDate: "asc" },
        { periodEndDate: "asc" },
        { receiptSequence: { sort: "asc", nulls: "last" } },
        { receiptNumber: "asc" },
        { id: "asc" },
      ],
    }),
    db.payment.findMany({
      where: { policyId: id, organizationId: scope.organizationId, status: "POSTED" },
      include: { client: true },
      orderBy: [{ paidDate: "desc" }, { id: "desc" }],
      take: 10,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      policyId: id,
      limit: 10,
      organizationId: scope.organizationId,
    }, db),
    db.document.findMany({
      where: { policyId: id, organizationId: scope.organizationId },
      include: { receipt: true, task: true, claim: true, endorsement: true },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
    db.policyEndorsement.findMany({
      where: { policyId: id, organizationId: scope.organizationId },
      include: {
        receipts: {
          include: { client: true, insurer: true, endorsement: true },
          orderBy: [
            { periodStartDate: "asc" },
            { periodEndDate: "asc" },
            { receiptSequence: { sort: "asc", nulls: "last" } },
            { receiptNumber: "asc" },
            { id: "asc" },
          ],
        },
        documents: {
          include: {
            receipt: true,
            endorsement: true,
          },
        },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    }),
    getActivityForEntity("Policy", id, 20, scope.organizationId, db),
    getPolicyFamilyPolicies(id, scope.organizationId),
  ]);

  const policyReceiptRows = receipts.map((receipt) => ({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    originLabel: getReceiptOriginLabel(receipt),
    dueDate: receipt.dueDate.toISOString().slice(0, 10),
    status: receipt.status,
    amount: toNumber(receipt.amount),
    currency: receipt.currency,
  }));
  const premiumReconciliation = reconcilePolicyReceiptPremium(Number(policy.premiumAmount), receipts.map((receipt) => ({
    id: receipt.id,
    amount: toNumber(receipt.amount),
    status: receipt.status,
    receiptSequence: receipt.receiptSequence,
    endorsementId: receipt.endorsementId,
    cancelledAt: receipt.cancelledAt,
    cancellationReason: receipt.cancellationReason,
    postedPaymentCount: receipt.payments.length,
  })));
  const activeEndorsements = endorsements.filter((endorsement) => endorsement.status === "ACTIVE");
  const expiredEndorsements = endorsements.filter((endorsement) => endorsement.status === "EXPIRED");
  const cancelledEndorsements = endorsements.filter((endorsement) => endorsement.status === "CANCELLED");
  const openWorkItemCount = await countWorkItems({
    workItemTypes: ["TASK"],
    statuses: OPEN_WORK_ITEM_STATUSES,
    policyId: id,
    organizationId: scope.organizationId,
  }, db);
  const activeBaseReceipts = receipts.filter((receipt) => receipt.status !== "CANCELLED");
  const basePendingCount = activeBaseReceipts.filter((receipt) => receipt.status !== "PAID").length;
  const paidBaseReceiptCount = activeBaseReceipts.filter((receipt) => receipt.status === "PAID").length;
  const renewalDays = daysUntil(policy.endDate);
  return (
    <div className="flex flex-col gap-6">
      <RecordPageView id={policy.id} label={`${policy.policyNumber} · ${policy.client.fullName}`} href={`/policies/${policy.id}`} type="Póliza" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow={`CRM · ${policyTypeLabel(policy.policyType)}`}
          title={policy.policyNumber}
          description={`${policy.client.fullName} · ${policy.insurer.name}`}
          actions={
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <StatusBadge status={policy.status} />
              <NoraContextButton context={{ type: "policy", id: policy.id }} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/policies/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              {isAdmin ? <DeletePolicyButton id={id} policyNumber={policy.policyNumber} /> : null}
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={returnTo}>
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <section aria-label="Resumen de póliza" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prima total de póliza</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{formatCurrency(policy.premiumAmount, policy.currency)}</p>
            <p className={`mt-1 text-xs ${premiumReconciliation.status === "RECONCILED" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
              {premiumReconciliation.status === "RECONCILED" ? "Conciliada con recibos" : `Revisar diferencia ${formatCurrency(premiumReconciliation.difference, policy.currency)}`}
            </p>
            {premiumReconciliation.status === "REVIEW" && isAdmin ? (
              <Link className="mt-1 inline-block text-xs font-medium text-primary hover:underline" href={`/data-quality?tab=revisiones&q=${encodeURIComponent(policy.policyNumber)}`}>
                Abrir revisión
              </Link>
            ) : null}
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vigencia</p>
            <p className="mt-2 text-base font-semibold text-foreground">{formatDate(policy.startDate)} — {formatDate(policy.endDate)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}{policy.paymentPlan ? ` · ${policy.paymentPlan}` : ""}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recibos</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{activeBaseReceipts.length} vigentes</p>
            <p className="mt-1 text-xs text-muted-foreground">{paidBaseReceiptCount} pagados · {basePendingCount} abiertos</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Renovación</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{renewalDays >= 0 ? `${renewalDays} días` : `Venció hace ${Math.abs(renewalDays)} días`}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatDate(policy.endDate)}</p>
          </div>
        </section>

        <PolicyRiskOverview
          policyType={policy.policyType}
          clientId={policy.clientId}
          clientName={policy.client.fullName}
          insurerName={policy.insurer.name}
          insuredObject={policy.insuredObject}
          riskDetails={policy.riskDetails}
          riskDetailsReviewRequired={policy.riskDetailsReviewRequired}
          insuredAssets={policy.insuredAssets}
          insuredParties={policy.insuredParties}
          notes={policy.notes}
          paymentPlan={policy.paymentPlan}
          paymentFrequency={policy.paymentFrequency}
          paymentFrequencyLabel={frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}
          beneficiaryInfo={policy.beneficiaryInfo}
          commissionRateOverride={policy.commissionRateOverride === null ? null : Number(policy.commissionRateOverride)}
        />

        <section aria-labelledby="related-policy-heading" className="space-y-3">
          <div>
            <h2 id="related-policy-heading" className="text-lg font-semibold text-foreground">Información relacionada</h2>
            <p className="mt-1 text-sm text-muted-foreground">Abre un apartado para consultar su detalle.</p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <PolicyDisclosure title="Recibos y pagos" summary={`${activeBaseReceipts.length} recibos vigentes · ${basePendingCount} abiertos · ${payments.length} pagos recientes`}>
              <div className="space-y-5 p-4">
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">Recibos de la vigencia base</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Prima total de póliza: {formatCurrency(policy.premiumAmount, policy.currency)}</p>
                    </div>
                    <Button asChild size="sm" className="rounded-full">
                      <Link href={`/receipts/new?policyId=${id}`}><Plus className="mr-2 size-4" />Nuevo recibo</Link>
                    </Button>
                  </div>
                  <PolicyReceiptsTable receipts={policyReceiptRows} />
                </div>
                <div className="border-t border-border/70 pt-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold text-foreground">Pagos recientes</h3>
                    <Link href={`/receipts?tab=historico&q=${encodeURIComponent(policy.policyNumber)}`} className="text-sm font-medium text-primary hover:underline">Ver historial completo</Link>
                  </div>
                  {payments.length ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow className="bg-muted/40"><TableHead>Fecha</TableHead><TableHead>Cliente</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                        <TableBody>{payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>{formatDate(payment.paidDate)}</TableCell>
                            <TableCell>{payment.client.fullName}</TableCell>
                            <TableCell className="font-mono text-xs">{payment.reference ?? "Sin referencia"}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(payment.amount, payment.currency)}</TableCell>
                          </TableRow>
                        ))}</TableBody>
                      </Table>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Todavía no hay pagos registrados.</p>}
                </div>
              </div>
            </PolicyDisclosure>

            <PolicyDisclosure title="Endosos" summary={`${activeEndorsements.length} activos · ${expiredEndorsements.length} vencidos · ${cancelledEndorsements.length} cancelados`}>
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">Ajustes ligados a esta póliza base, con sus propios recibos y documentos.</p>
                  <Button asChild size="sm" className="rounded-full"><Link href={`/policies/${id}/endorsements/new`}><Plus className="mr-2 size-4" />Nuevo endoso</Link></Button>
                </div>
                {endorsements.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Todavía no hay endosos para esta póliza.</p>
                ) : endorsements.map((endorsement) => {
                  const endorsementReconciliation = reconcileEndorsementReceiptPremium(Number(endorsement.amount), endorsement.receipts.map((receipt) => ({ amount: toNumber(receipt.amount), status: receipt.status })));
                  return (
                    <article key={endorsement.id} className="space-y-4 rounded-xl border border-border/70 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/policies/${id}/endorsements/${endorsement.id}/edit`} className="font-semibold text-foreground hover:text-primary">Endoso {endorsement.endorsementNumber}</Link>
                            <StatusBadge status={endorsement.status} />
                          </div>
                          <p className="text-sm text-muted-foreground">{formatDate(endorsement.startDate)} · {formatDate(endorsement.endDate)} · {formatCurrency(endorsement.amount, endorsement.currency)}</p>
                          <p className={`text-xs ${endorsementReconciliation.status === "RECONCILED" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                            Recibos {endorsementReconciliation.status === "RECONCILED" ? "conciliados" : "requieren revisión"}: {formatCurrency(endorsementReconciliation.receiptTotal, endorsement.currency)} · diferencia {formatCurrency(endorsementReconciliation.difference, endorsement.currency)}.
                          </p>
                          {endorsement.reference ? <p className="text-xs text-muted-foreground">Referencia: {endorsement.reference}</p> : null}
                          {endorsement.concept ? <p className="text-xs text-muted-foreground">Concepto: {endorsement.concept}</p> : null}
                          {endorsement.notes ? <p className="text-xs text-muted-foreground">{endorsement.notes}</p> : null}
                        </div>
                        <Button asChild variant="outline" size="sm" className="rounded-full bg-card/70"><Link href={`/policies/${id}/endorsements/${endorsement.id}/edit`}>Editar</Link></Button>
                      </div>
                      <div className="space-y-3 border-t border-border/70 pt-3">
                        <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium">Recibos del endoso</h4><span className="text-xs text-muted-foreground">{endorsement.receipts.length} recibo(s)</span></div>
                        {endorsement.receipts.length ? <PolicyReceiptsTable receipts={endorsement.receipts.map((receipt, index) => ({
                          id: receipt.id,
                          receiptNumber: receipt.receiptNumber,
                          displayLabel: String(index + 1),
                          secondaryLabel: `Folio ${receipt.receiptNumber}`,
                          originLabel: getReceiptOriginLabel(receipt),
                          dueDate: receipt.dueDate.toISOString().slice(0, 10),
                          status: receipt.status,
                          amount: Number(receipt.amount),
                          currency: receipt.currency,
                        }))} /> : <p className="text-sm text-muted-foreground">Este endoso todavía no tiene recibos asociados.</p>}
                        <Button asChild size="sm" variant="outline" className="rounded-full"><Link href={`/receipts/new?policyId=${id}&endorsementId=${endorsement.id}`}><Plus className="mr-2 size-4" />Nuevo recibo de endoso</Link></Button>
                      </div>
                      <div className="space-y-3 border-t border-border/70 pt-3">
                        <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium">Documentos del endoso</h4><span className="text-xs text-muted-foreground">{endorsement.documents.length} archivo(s)</span></div>
                        <DocumentDropZone associations={{ policyId: id, clientId: policy.clientId, endorsementId: endorsement.id }} defaultDocumentType="ENDORSEMENT" title="Subir documentos del endoso" description="Adjunta el aviso de pago, PDF o soporte de este endoso." />
                        <DocumentList showAssociation documents={endorsement.documents.map((doc) => ({
                          id: doc.id,
                          fileName: doc.fileName,
                          documentType: doc.documentType,
                          mimeType: doc.mimeType,
                          uploadedAt: doc.uploadedAt,
                          associationLabel: doc.receipt?.receiptNumber ?? doc.endorsement?.endorsementNumber ?? "Endoso",
                        }))} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </PolicyDisclosure>

            <PolicyDisclosure title="Tareas abiertas" summary={`${openWorkItemCount} abiertas · ${workItems.length} recientes`}>
              <div className="p-4">
                {workItems.length ? <div className="divide-y divide-border/70">{workItems.map((task) => (
                  <div key={task.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/tasks/${task.sourceId ?? task.id}`} className="font-medium text-foreground hover:text-primary">{task.folio ?? task.sourceId ?? task.id}</Link>
                      <div className="flex gap-2"><PriorityBadge priority={task.priority} /><StatusBadge status={task.status} /></div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}</p>
                  </div>
                ))}</div> : <p className="text-sm text-muted-foreground">No hay tareas abiertas asociadas a esta póliza.</p>}
                <Link href={`/operations?view=pending&q=${encodeURIComponent(policy.policyNumber)}`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Ver tareas en Operación</Link>
              </div>
            </PolicyDisclosure>

            <PolicyDisclosure title="Documentos" summary={`${documents.length} archivos recientes asociados`}>
              <div className="space-y-4 p-4">
                <DocumentDropZone associations={{ policyId: id, clientId: policy.clientId }} defaultDocumentType="POLICY" />
                <DocumentList showAssociation documents={documents.map((document) => ({
                  id: document.id,
                  fileName: document.fileName,
                  documentType: document.documentType,
                  mimeType: document.mimeType,
                  uploadedAt: document.uploadedAt,
                  previewAvailable: document.filePath.startsWith(`demo://${scope.organizationId}/`),
                  associationLabel: document.receipt?.receiptNumber ?? document.task?.folio ?? document.claim?.folio ?? "Póliza",
                }))} />
                <Link href={`/documents?q=${encodeURIComponent(policy.policyNumber)}`} className="inline-block text-sm font-medium text-primary hover:underline">Ver archivo completo</Link>
              </div>
            </PolicyDisclosure>

            <PolicyDisclosure title="Actividad e historial" summary={`${activity.length} eventos recientes · cambios de la póliza`}>
              <div className="space-y-4 p-4">
                <AuditByline createdById={policy.createdById} updatedById={policy.updatedById} />
                {activity.length ? <ActivityTimeline entries={activity} /> : <p className="text-sm text-muted-foreground">Sin actividad registrada para esta póliza todavía.</p>}
                <Link href={`/activity?entity=Policy&id=${id}`} className="inline-block text-sm font-medium text-primary hover:underline">Ver todo el historial</Link>
              </div>
            </PolicyDisclosure>

            {family && family.policies.length > 1 ? (
              <PolicyDisclosure title="Historial de vigencias" summary={`${family.policies.length} vigencias registradas`}>
                <div className="overflow-x-auto p-4">
                  <Table>
                    <TableHeader><TableRow className="bg-muted/40"><TableHead>Vigencia</TableHead><TableHead>Periodo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Prima</TableHead><TableHead className="text-right">Recibos</TableHead><TableHead className="text-right">Pagos</TableHead></TableRow></TableHeader>
                    <TableBody>{family.policies.map((term: (typeof family.policies)[number]) => (
                      <TableRow key={term.id} className={term.id === policy.id ? "bg-muted/25" : undefined}>
                        <TableCell><Link href={`/policies/${term.id}`} className="font-medium text-foreground hover:text-primary">{term.policyNumber}</Link><p className="text-xs text-muted-foreground">{term.id === policy.id ? "Vigencia actual" : "Histórica"}</p></TableCell>
                        <TableCell>{formatDate(term.startDate)} · {formatDate(term.endDate)}</TableCell>
                        <TableCell><StatusBadge status={term.status} /></TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(term.premiumAmount, term.currency)}</TableCell>
                        <TableCell className="text-right">{term._count.receipts}</TableCell>
                        <TableCell className="text-right">{term._count.payments}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              </PolicyDisclosure>
            ) : null}
          </div>
        </section>

        {previousPolicy && renewalComparison ? (
          <PolicyRenewalComparison
            comparison={renewalComparison}
            previousPolicyNumber={previousPolicy.policyNumber}
            previousPolicyHref={`/policies/${previousPolicy.id}`}
            editHref={`/policies/${policy.id}/edit`}
          />
        ) : null}
      </div>
    </div>
  );
});
}
