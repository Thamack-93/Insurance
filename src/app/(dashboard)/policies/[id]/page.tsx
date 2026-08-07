import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordPageView } from "@/components/recently-viewed/record-page-view";
import { ArrowLeft, FileClock, History, Pencil, Plus, ReceiptText, Repeat, Shield } from "@/components/icons";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";
import { PageHeader } from "@/components/layout/page-header";
import { NoraContextButton } from "@/components/assistant/nora-session-provider";
import { AuditByline } from "@/components/audit/audit-byline";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocumentDropZone } from "@/components/documents/document-drop-zone";
import { DocumentList } from "@/components/documents/document-list";
import { PolicyReceiptsTable } from "@/components/policies/policy-receipts-table";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { policyOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import { getPolicyFamilyPolicies } from "@/lib/policy-families";
import { policyTypeLabel } from "@/lib/status";
import { countWorkItems, getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";

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
  const scope = await requirePortfolioReadScope();
  const liveUser = await getCurrentUser();
  const isAdmin = !!liveUser && liveUser.active && liveUser.role === "ADMIN";
  const db = getDb();

  const policy = await db.policy.findFirst({
    where: { id, ...policyOperationalWhere(scope.portfolioOwnerId) },
    include: {
      client: true,
      insurer: true,
      renewedFrom: {
        select: {
          id: true,
          policyNumber: true,
        },
      },
      renewals: {
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

  const [
    receipts,
    baseReceiptCount,
    basePendingCount,
    basePendingAmountAgg,
    endorsementReceiptCount,
    endorsementPendingCount,
    endorsementPendingAmountAgg,
    payments,
    commissions,
    workItems,
    documents,
    endorsements,
    activity,
    family,
  ] = await Promise.all([
    db.receipt.findMany({
      where: { policyId: id, endorsementId: null },
      include: { client: true, insurer: true, endorsement: true },
      orderBy: { dueDate: "desc" },
      take: 10,
    }),
    db.receipt.count({
      where: {
        policyId: id,
        endorsementId: null,
      },
    }),
    db.receipt.count({
      where: {
        policyId: id,
        endorsementId: null,
        status: { notIn: ["PAID", "CANCELLED"] },
      },
    }),
    db.receipt.aggregate({
      where: {
        policyId: id,
        endorsementId: null,
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      _sum: { amount: true },
    }),
    db.receipt.count({
      where: {
        policyId: id,
        endorsementId: { not: null },
      },
    }),
    db.receipt.count({
      where: {
        policyId: id,
        endorsementId: { not: null },
        status: { notIn: ["PAID", "CANCELLED"] },
      },
    }),
    db.receipt.aggregate({
      where: {
        policyId: id,
        endorsementId: { not: null },
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      _sum: { amount: true },
    }),
    db.payment.findMany({
      where: { policyId: id, status: "POSTED" },
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
    getWorkItems({
      workItemTypes: ["TASK"],
      policyId: id,
      limit: 10,
    }),
    db.document.findMany({
      where: { policyId: id },
      include: { receipt: true, task: true, claim: true, quote: true, endorsement: true },
      orderBy: { uploadedAt: "desc" },
      take: 10,
    }),
    db.policyEndorsement.findMany({
      where: { policyId: id },
      include: {
        receipts: {
          include: { client: true, insurer: true, endorsement: true },
          orderBy: { dueDate: "asc" },
        },
        documents: {
          include: {
            receipt: true,
            endorsement: true,
          },
        },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
    getActivityForEntity("Policy", id, 20),
    getPolicyFamilyPolicies(id),
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
  const activeEndorsements = endorsements.filter((endorsement) => endorsement.status === "ACTIVE");
  const expiredEndorsements = endorsements.filter((endorsement) => endorsement.status === "EXPIRED");
  const cancelledEndorsements = endorsements.filter((endorsement) => endorsement.status === "CANCELLED");
  const basePendingAmount = toNumber(basePendingAmountAgg._sum.amount);
  const endorsementPendingAmount = toNumber(endorsementPendingAmountAgg._sum.amount);
  const openCommissions = commissions.filter((commission) => commission.status !== "PAID" && commission.status !== "CANCELLED");
  const openWorkItemCount = await countWorkItems({
    workItemTypes: ["TASK"],
    statuses: OPEN_WORK_ITEM_STATUSES,
    policyId: id,
  });
  const paymentsTotal = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <RecordPageView id={policy.id} label={`${policy.policyNumber} · ${policy.client.fullName}`} href={`/policies/${policy.id}`} type="Póliza" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={policy.policyNumber}
          description={`${policy.client.fullName} · ${policy.insurer.name} · ${policyTypeLabel(policy.policyType)}`}
          actions={
            <div className="flex items-center gap-2">
              <NoraContextButton context={{ type: "policy", id: policy.id }} />
              <Button asChild variant="outline" className="bg-card/70">
                <Link href={`/policies/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              {isAdmin ? <DeletePolicyButton id={id} policyNumber={policy.policyNumber} /> : null}
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/policies">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <AuditByline createdById={policy.createdById} updatedById={policy.updatedById} />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            title="Prima"
            value={formatCurrency(policy.premiumAmount, policy.currency)}
            description={frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Recibos póliza"
            value={baseReceiptCount}
            description={`${basePendingCount} abiertos en la vigencia base.`}
            icon={ReceiptText}
            tone="amber"
          />
          <MetricCard
            title="Recibos endosos"
            value={endorsementReceiptCount}
            description={`${endorsementPendingCount} abiertos en endosos.`}
            icon={Repeat}
            tone="blue"
          />
          <MetricCard
            title="Endosos activos"
            value={activeEndorsements.length}
            description={`${expiredEndorsements.length} vencidos · ${cancelledEndorsements.length} cancelados`}
            icon={Repeat}
            tone="blue"
          />
          <MetricCard
            title="Comisiones abiertas"
            value={openCommissions.length}
            description="Esperadas, pendientes u observadas."
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Tareas abiertas"
            value={openWorkItemCount}
            description={`${daysUntil(policy.endDate)} días para renovación`}
            icon={FileClock}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Póliza base" description="Contexto operativo y comercial de la vigencia base.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={policy.status} entity="policy" />
                <Badge variant="outline" className="rounded-full">
                  {policyTypeLabel(policy.policyType)}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo póliza</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(basePendingAmount, policy.currency)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{basePendingCount} recibo(s) abiertos</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo endosos</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(endorsementPendingAmount, policy.currency)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{endorsementPendingCount} recibo(s) abiertos</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Endosos vigentes</p>
                  <p className="mt-1 text-lg font-semibold">{activeEndorsements.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{expiredEndorsements.length} vencidos · {cancelledEndorsements.length} cancelados</p>
                </div>
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
                  <p className="font-medium">{formatDate(policy.endDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Frecuencia</p>
                  <p className="font-medium">{frequencyLabels[policy.paymentFrequency] ?? policy.paymentFrequency}</p>
                </div>
                {policy.renewedFrom ? (
                  <div>
                    <p className="text-muted-foreground">Renueva de</p>
                    <Link href={`/policies/${policy.renewedFrom.id}`} className="font-medium text-foreground hover:text-primary">
                      {policy.renewedFrom.policyNumber}
                    </Link>
                  </div>
                ) : null}
                {policy.renewals.length ? (
                  <div>
                    <p className="text-muted-foreground">Renueva a</p>
                    <div className="mt-1 space-y-1">
                      {policy.renewals.map((renewal) => (
                        <Link
                          key={renewal.id}
                          href={`/policies/${renewal.id}`}
                          className="block font-medium text-foreground hover:text-primary"
                        >
                          {renewal.policyNumber}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
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
              <SectionCard title="Asegurados y activos">
                <div className="space-y-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">Personas aseguradas</p>
                    {policy.insuredParties.length ? (
                      <ul className="mt-2 space-y-2 text-muted-foreground">
                        {policy.insuredParties.map((party) => (
                          <li key={party.id} className="flex items-center justify-between gap-3">
                            <span>{party.fullName}</span>
                            <span className="text-xs uppercase tracking-wide">{party.isPrimary ? "Principal" : "Secundario"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-muted-foreground">Sin personas aseguradas registradas.</p>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Activos asegurados</p>
                    {policy.insuredAssets.length ? (
                      <ul className="mt-2 space-y-2 text-muted-foreground">
                        {policy.insuredAssets.map((asset) => (
                          <li key={asset.id} className="flex flex-col gap-1 rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span>{asset.assetType}</span>
                              <span className="text-xs uppercase tracking-wide">{asset.isPrimary ? "Principal" : "Secundario"}</span>
                            </div>
                            <span>{asset.description}</span>
                            {asset.serialNumber ? <span className="text-xs text-muted-foreground">Serie: {asset.serialNumber}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-muted-foreground">Sin activos asegurados registrados.</p>
                    )}
                  </div>
                </div>
              </SectionCard>
              {policy.notes ? <p className="text-sm text-muted-foreground">{policy.notes}</p> : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Recibos de la póliza"
            description="Calendario de cobro derivado solo de la vigencia base."
            action={
              <Button asChild size="sm">
                <Link href={`/receipts/new?policyId=${id}`}>
                  <Plus className="mr-2 size-4" />
                  Nuevo recibo de póliza
                </Link>
              </Button>
            }
          >
            <PolicyReceiptsTable receipts={policyReceiptRows} />
          </SectionCard>

          <SectionCard
            title="Endosos"
            description="Ajustes ligados a esta póliza base, cada uno con sus propios recibos y documentos."
            action={
              <Button asChild size="sm">
                <Link href={`/policies/${id}/endorsements/new`}>
                  <Plus className="mr-2 size-4" />
                  Nuevo endoso
                </Link>
              </Button>
            }
          >
            {endorsements.length === 0 ? (
              <div className="p-4">
                <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                  <ReceiptText className="mx-auto mb-2 size-5 text-muted-foreground" />
                  Todavía no hay endosos para esta póliza.
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                {endorsements.map((endorsement) => (
                  <div key={endorsement.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/policies/${id}/endorsements/${endorsement.id}/edit`}
                            className="text-lg font-semibold text-foreground hover:text-primary"
                          >
                            Endoso {endorsement.endorsementNumber}
                          </Link>
                          <StatusBadge status={endorsement.status} entity="endorsement" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(endorsement.startDate)} · {formatDate(endorsement.endDate)} ·{" "}
                          {formatCurrency(endorsement.amount, endorsement.currency)}
                        </p>
                        {endorsement.reference ? (
                          <p className="text-xs text-muted-foreground">Referencia: {endorsement.reference}</p>
                        ) : null}
                        {endorsement.concept ? (
                          <p className="text-xs text-muted-foreground">Concepto: {endorsement.concept}</p>
                        ) : null}
                        {endorsement.notes ? <p className="text-xs text-muted-foreground">{endorsement.notes}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" size="sm" className="bg-card/70">
                          <Link href={`/policies/${id}/endorsements/${endorsement.id}/edit`}>Editar</Link>
                        </Button>
                        <Button asChild size="sm">
                          <Link href={`/receipts/new?policyId=${id}&endorsementId=${endorsement.id}`}>Nuevo recibo de endoso</Link>
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">Recibos del endoso</p>
                        <span className="text-xs text-muted-foreground">{endorsement.receipts.length} recibo(s)</span>
                      </div>
                      {endorsement.receipts.length > 0 ? (
                        <PolicyReceiptsTable
                          receipts={endorsement.receipts.map((receipt, index) => ({
                            id: receipt.id,
                            receiptNumber: receipt.receiptNumber,
                            displayLabel: String(index + 1),
                            secondaryLabel: `Folio ${receipt.receiptNumber}`,
                            originLabel: getReceiptOriginLabel(receipt),
                            dueDate: receipt.dueDate.toISOString().slice(0, 10),
                            status: receipt.status,
                            amount: Number(receipt.amount),
                            currency: receipt.currency,
                          }))}
                        />
                      ) : (
                        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                          Este endoso todavía no tiene recibos asociados.
                        </div>
                      )}
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">Documentos del endoso</p>
                        <span className="text-xs text-muted-foreground">{endorsement.documents.length} archivo(s)</span>
                      </div>
                      <DocumentDropZone
                        associations={{ policyId: id, clientId: policy.clientId, endorsementId: endorsement.id }}
                        defaultDocumentType="ENDORSEMENT"
                        title="Subir documentos del endoso"
                        description="Adjunta el aviso de pago, PDF o soporte de este endoso."
                      />
                      <DocumentList
                        showAssociation
                        documents={endorsement.documents.map((doc) => ({
                          id: doc.id,
                          fileName: doc.fileName,
                          documentType: doc.documentType,
                          mimeType: doc.mimeType,
                          uploadedAt: doc.uploadedAt,
                          associationLabel:
                            doc.receipt?.receiptNumber ??
                            doc.endorsement?.endorsementNumber ??
                            "Endoso",
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>

        {family && family.policies.length > 1 ? (
          <SectionCard
            title="Historial de vigencias"
            description={`Esta familia tiene ${family.policies.length} vigencias registradas. La póliza actual muestra solo su periodo propio.`}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                  <TableHead className="text-right">Recibos</TableHead>
                  <TableHead className="text-right">Pagos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {family.policies.map((term) => (
                  <TableRow key={term.id} className={term.id === policy.id ? "bg-muted/25" : undefined}>
                    <TableCell>
                      <Link href={`/policies/${term.id}`} className="font-medium text-foreground hover:text-primary">
                        {term.policyNumber}
                      </Link>
                      {term.id === policy.id ? (
                        <p className="text-xs text-muted-foreground">Vigencia actual</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Histórica</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDate(term.startDate)} · {formatDate(term.endDate)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={term.status} entity="policy" />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(term.premiumAmount, term.currency)}</TableCell>
                    <TableCell className="text-right">{term._count.receipts}</TableCell>
                    <TableCell className="text-right">{term._count.payments}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        ) : null}

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
                      <StatusBadge status={commission.status} entity="commission" />
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
                {workItems.map((task) => (
                  <div key={task.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/tasks/${task.sourceId ?? task.id}`} className="font-medium text-foreground hover:text-primary">
                        {task.folio ?? task.sourceId ?? task.id}
                      </Link>
                      <div className="flex gap-2">
                        <PriorityBadge priority={task.priority} />
                        <StatusBadge status={task.status} entity="workItem" />
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
          <div className="space-y-4 p-4">
            <DocumentDropZone
              associations={{ policyId: id, clientId: policy.clientId }}
              defaultDocumentType="POLICY"
            />
            <DocumentList
              showAssociation
              documents={documents.map((d) => ({
                id: d.id,
                fileName: d.fileName,
                documentType: d.documentType,
                mimeType: d.mimeType,
                uploadedAt: d.uploadedAt,
                associationLabel:
                  d.receipt?.receiptNumber ??
                  d.task?.folio ??
                  d.claim?.folio ??
                  d.quote?.id ??
                  "Póliza",
              }))}
            />
          </div>
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
              <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 size-5 text-muted-foreground" />
                Sin actividad registrada para esta póliza todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
