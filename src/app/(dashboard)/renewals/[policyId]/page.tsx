import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { ClientActionBriefing } from "@/components/clients/client-action-briefing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decodeRouteIdentifier } from "@/lib/route-identifier";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { getClientActionBriefingFromDb } from "@/lib/client-action-briefing";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { documentOperationalWhere, policyOperationalWhere, receiptOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { withTenantOrganization } from "@/lib/tenant-dal";

export default async function RenewalPreparationPage({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId: rawPolicyId } = await params;
  const policyId = decodeRouteIdentifier(rawPolicyId);
  if (!policyId) notFound();

  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
    const policy = await db.policy.findFirst({
      where: { id: policyId, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      select: {
        id: true, policyNumber: true, status: true, policyType: true, startDate: true, endDate: true,
        premiumAmount: true, currency: true, paymentFrequency: true, insuredObject: true, riskDetails: true,
        riskDetailsReviewRequired: true, renewedFromPolicyId: true,
        client: { select: { id: true, fullName: true, phone: true, email: true, rfc: true } },
        insurer: { select: { name: true } },
        insuredAssets: { select: { id: true, description: true, assetType: true, serialNumber: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { id: true, fullName: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        renewals: { where: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId), select: { id: true, policyNumber: true, status: true } },
      },
    });
    if (!policy) notFound();

    const [receipts, tasks, documents, suggestions, clientActions] = await Promise.all([
      db.receipt.findMany({
        where: { ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId), policyId, status: { in: ["PENDING", "OVERDUE"] } },
        select: { id: true, receiptNumber: true, dueDate: true, amount: true, currency: true, status: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      }),
      getWorkItems({ organizationId: scope.organizationId, portfolioOwnerId: scope.portfolioOwnerId, clientId: policy.client.id, policyId, statuses: OPEN_WORK_ITEM_STATUSES, workItemTypes: ["TASK"], limit: 100 }, db),
      db.document.findMany({
        where: {
          organizationId: scope.organizationId,
          ...documentOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          OR: [{ policyId }, { clientId: policy.client.id }],
        },
        select: { id: true, fileName: true, documentType: true, uploadedAt: true, policyId: true, clientId: true },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
      db.policyRenewalSuggestion.findMany({
        where: { organizationId: scope.organizationId, sourcePolicyId: policyId, status: "PENDING", sourcePolicy: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
        select: { id: true, reason: true, confidence: true, targetPolicy: { select: { id: true, policyNumber: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      getClientActionBriefingFromDb(scope, db, policy.client.id),
    ]);

    const riskDetails = policy.riskDetails && typeof policy.riskDetails === "object" && !Array.isArray(policy.riskDetails)
      ? Object.entries(policy.riskDetails as Record<string, unknown>).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      : [];

    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          eyebrow="Renovaciones · preparación"
          title={`Preparar renovación · ${policy.policyNumber}`}
          description="Vista de consulta para reunir el contexto de la póliza y sus pendientes antes de revisar la renovación."
          metadata={<><Badge variant="outline">{policy.status}</Badge><span>{policy.insurer.name}</span><span>{formatCurrency(Number(policy.premiumAmount), policy.currency)}</span></>}
          actions={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={`/operations?view=renewals`}>Volver al tablero</Link></Button><Button asChild variant="outline"><Link href={`/policies/${policy.id}`}>Abrir póliza</Link></Button></div>}
        />

        <SectionCard title="Póliza origen y vigencia" description="La renovación se prepara desde los datos registrados en la póliza vigente.">
          <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Póliza</dt><dd><Link className="font-mono font-medium hover:underline" href={`/policies/${policy.id}`}>{policy.policyNumber}</Link></dd></div>
            <div><dt className="text-xs text-muted-foreground">Inicio</dt><dd>{formatDate(policy.startDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Vencimiento</dt><dd>{formatDate(policy.endDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Frecuencia de pago</dt><dd>{policy.paymentFrequency}</dd></div>
            {policy.renewals.map((renewal) => <div key={renewal.id}><dt className="text-xs text-muted-foreground">Renovación vinculada</dt><dd><Link className="font-mono hover:underline" href={`/policies/${renewal.id}`}>{renewal.policyNumber}</Link> · {renewal.status}</dd></div>)}
          </dl>
        </SectionCard>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SectionCard title="Recibos pendientes" description="Recibos abiertos asociados a esta póliza.">
            {receipts.length ? <ul className="divide-y divide-border/70">{receipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><Link className="font-mono font-medium hover:underline" href={`/receipts/${receipt.id}`}>{receipt.receiptNumber}</Link><p className="text-xs text-muted-foreground">Vence {formatDate(receipt.dueDate)} · {receipt.status}</p></div><span className="font-mono text-sm">{formatCurrency(Number(receipt.amount), receipt.currency)}</span></li>)}</ul> : <p className="px-4 py-5 text-sm text-muted-foreground">No hay recibos pendientes asociados.</p>}
          </SectionCard>
          <SectionCard title="Tareas abiertas" description="Pendientes operativos enlazados a la póliza.">
            {tasks.length ? <ul className="divide-y divide-border/70">{tasks.map((task) => <li key={task.id} className="px-4 py-3"><Link className="font-medium hover:underline" href={`/tasks/${task.id}`}>{task.title}</Link><p className="text-xs text-muted-foreground">{task.status}{task.dueDate ? ` · vence ${formatDate(task.dueDate)}` : ""}</p></li>)}</ul> : <p className="px-4 py-5 text-sm text-muted-foreground">No hay tareas abiertas asociadas.</p>}
          </SectionCard>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SectionCard title="Riesgos asegurados" description="Bienes y personas aseguradas según el registro actual.">
            <div className="space-y-4 p-4">
              {policy.insuredObject ? <p className="text-sm">{policy.insuredObject}</p> : null}
              {policy.insuredAssets.length ? <ul className="space-y-2">{policy.insuredAssets.map((asset) => <li key={asset.id} className="text-sm"><span className="font-medium">{asset.description}</span><span className="ml-2 text-xs text-muted-foreground">{asset.assetType}{asset.serialNumber ? ` · serie ${asset.serialNumber}` : ""}</span></li>)}</ul> : null}
              {policy.insuredParties.length ? <p className="text-sm"><span className="font-medium">Personas aseguradas: </span>{policy.insuredParties.map((party) => party.fullName).join(", ")}</p> : null}
              {riskDetails.map(([key, value]) => <p key={key} className="text-xs text-muted-foreground">{key}: {String(value)}</p>)}
              {!policy.insuredObject && !policy.insuredAssets.length && !policy.insuredParties.length && !riskDetails.length ? <p className="text-sm text-muted-foreground">No hay detalles de riesgos registrados.</p> : null}
            </div>
          </SectionCard>
          <SectionCard title="Contacto del cliente" description="Canales existentes del cliente, sin iniciar contacto.">
            <div className="space-y-2 p-4 text-sm">
              <Link className="font-medium hover:underline" href={`/clients/${policy.client.id}`}>{policy.client.fullName}</Link>
              {policy.client.phone ? <p><a className="hover:underline" href={`tel:${policy.client.phone}`}>{policy.client.phone}</a></p> : <p className="text-muted-foreground">Sin teléfono registrado</p>}
              {policy.client.email ? <p><a className="hover:underline" href={`mailto:${policy.client.email}`}>{policy.client.email}</a></p> : <p className="text-muted-foreground">Sin correo registrado</p>}
              {policy.client.rfc ? <p className="text-xs text-muted-foreground">RFC {policy.client.rfc}</p> : null}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Documentos" description="Archivos ya asociados al cliente o a la póliza.">
          {documents.length ? <ul className="divide-y divide-border/70">{documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><a className="font-medium hover:underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noreferrer">{document.fileName}</a><span className="text-xs text-muted-foreground">{document.documentType} · {formatDate(document.uploadedAt)} · {document.policyId ? "Póliza" : "Cliente"}</span></li>)}</ul> : <p className="px-4 py-5 text-sm text-muted-foreground">No hay documentos asociados.</p>}
        </SectionCard>

        <SectionCard title="Confirmaciones y revisiones pendientes" description="Señales registradas que requieren revisión humana.">
          <ul className="divide-y divide-border/70">
            {policy.riskDetailsReviewRequired ? <li className="px-4 py-3"><Link className="font-medium hover:underline" href={`/policies/${policy.id}`}>Revisar los datos de riesgos de esta póliza</Link><p className="text-xs text-muted-foreground">La póliza tiene marcada una revisión pendiente de riesgos.</p></li> : null}
            {suggestions.map((suggestion) => <li key={suggestion.id} className="px-4 py-3"><Link className="font-medium hover:underline" href={suggestion.targetPolicy ? `/policies/${suggestion.targetPolicy.id}` : "/operations?view=renewals"}>Revisar posible renovación por serie{suggestion.targetPolicy ? ` · ${suggestion.targetPolicy.policyNumber}` : ""}</Link><p className="text-xs text-muted-foreground">{suggestion.reason ?? "Coincidencia pendiente de confirmar."}</p></li>)}
            {!policy.riskDetailsReviewRequired && suggestions.length === 0 ? <li className="px-4 py-5 text-sm text-muted-foreground">No hay confirmaciones pendientes registradas.</li> : null}
          </ul>
        </SectionCard>

        <ClientActionBriefing actions={clientActions} />
      </div>
    );
  });
}
