import Link from "next/link";
import { notFound } from "next/navigation";
import { decodeRouteIdentifier } from "@/lib/route-identifier";
import { RecordPageView } from "@/components/recently-viewed/record-page-view";
import { Mail, Phone, BadgeInfo, ClipboardList, History, Pencil, ShieldCheck } from "@/components/icons";
import { DeleteClientButton } from "@/components/clients/delete-client-button";
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
import { TableToolbar } from "@/components/tables/table-toolbar";
import { StatusFilterButtons } from "@/components/tables/status-filter-buttons";
import { DocumentDropZone } from "@/components/documents/document-drop-zone";
import { DocumentList } from "@/components/documents/document-list";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { clientOperationalWhere, claimOperationalWhere, documentOperationalWhere } from "@/lib/portfolio-access";
import { formatDate } from "@/lib/dates";
import { policyTypeLabel } from "@/lib/status";
import { policyStatusOptions } from "@/lib/domain-options";
import { POLICY_STATUSES } from "@/lib/domain-values";
import { readAllowedTableParam } from "@/lib/table-query";
import { formatCurrency, formatCurrencyExact, toNumber } from "@/lib/money";
import { getWorkItems } from "@/lib/work-queue";
import { calculateAge, formatBirthdayDate } from "@/lib/birthday-reminders";
import { normalizeReturnTo } from "@/lib/return-to";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { policyObjectSearchTerms } from "@/lib/policy-identity";
import { PolicyIdentity } from "@/components/policies/policy-identity";
import { CalendarDays, ChevronDown } from "lucide-react";
import { daysUntil, today } from "@/lib/dates";

export default async function ClientDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const routeParams = await params;
  const id = decodeRouteIdentifier(routeParams.id);
  if (!id) notFound();
  const query = (await searchParams) ?? {};
  const rawPolicyStatus = typeof query.policyStatus === "string" ? query.policyStatus : undefined;
  const policyStatus = rawPolicyStatus === "ALL"
    ? undefined
    : readAllowedTableParam(query, "policyStatus", POLICY_STATUSES) ?? "ACTIVE";
  const policyQuery = typeof query.q === "string" ? query.q.trim().slice(0, 100) : undefined;
  const returnTo = normalizeReturnTo(typeof query.returnTo === "string" ? query.returnTo : undefined, "/clients");
  const scope = await requireOrganizationPortfolioReadScope();
  const isAdmin = scope.membershipRole !== "AGENT";
  return withTenantOrganization(scope.organizationId, async (db) => {

  const client = await db.client.findFirst({
    where: { id, ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
    include: {
      referidor: {
        select: {
          id: true,
          fullName: true,
          status: true,
        },
      },
      _count: {
        select: {
          referidos: true,
        },
      },
    },
  });

  if (!client) {
    notFound();
  }

  const policyWhere = {
    clientId: id,
    organizationId: scope.organizationId,
    client: { organizationId: scope.organizationId },
    ...(policyStatus ? { status: policyStatus } : {}),
    ...(policyQuery
      ? {
          OR: [
            { policyNumber: { contains: policyQuery } },
            { insurer: { name: { contains: policyQuery } } },
            ...policyObjectSearchTerms(policyQuery),
          ],
        }
      : {}),
  };

  const [policies, receipts, workItems, claims, documents, referidos, activity, exactPolicyStats, exactReceiptCount, policyStatusCounts, totalPolicyCount, renewalCandidates] = await Promise.all([
    db.policy.findMany({
      where: policyWhere,
      include: {
        insurer: true,
        insuredAssets: { select: { description: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }, { id: "asc" }],
    }),
    db.receipt.findMany({
      where: { clientId: id, organizationId: scope.organizationId, client: { organizationId: scope.organizationId } },
      include: { policy: true, insurer: true },
      orderBy: [
        { dueDate: "desc" },
        { receiptSequence: { sort: "desc", nulls: "last" } },
        { receiptNumber: "desc" },
        { id: "desc" },
      ],
      take: 10,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      clientId: id,
      limit: 10,
      organizationId: scope.organizationId,
    }, db),
    db.claim.findMany({
      where: { clientId: id, ...claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: { policy: true, insurer: true },
      orderBy: [{ reportedDate: "desc" }, { id: "desc" }],
      take: 5,
    }),
    db.document.findMany({
      where: { clientId: id, ...documentOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: { policy: true, receipt: true, task: true, claim: true },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    db.client.findMany({
      where: { referidorId: id, organizationId: scope.organizationId },
      select: {
        id: true,
        fullName: true,
        type: true,
        status: true,
      },
      orderBy: { fullName: "asc" },
      take: 10,
    }),
    getActivityForEntity("Client", id, 20, scope.organizationId, db),
    db.policy.aggregate({
      where: { clientId: id, organizationId: scope.organizationId, status: "ACTIVE" },
      _count: { _all: true },
      _sum: { premiumAmount: true },
    }),
    db.receipt.count({
      where: { clientId: id, organizationId: scope.organizationId, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    db.policy.groupBy({
      by: ["status"],
      where: { clientId: id, organizationId: scope.organizationId, client: { organizationId: scope.organizationId } },
      _count: { _all: true },
    }),
    db.policy.count({
      where: { clientId: id, organizationId: scope.organizationId, client: { organizationId: scope.organizationId } },
    }),
    db.policy.findMany({
      where: { clientId: id, organizationId: scope.organizationId, client: { organizationId: scope.organizationId }, status: "ACTIVE", endDate: { gte: today() } },
      select: { id: true, policyNumber: true, policyType: true, endDate: true },
      orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
      take: 1,
    }),
  ]);

  const activePremium = toNumber(exactPolicyStats._sum.premiumAmount);
  const nextRenewal = renewalCandidates[0] ?? null;
  const nextRenewalDays = nextRenewal?.endDate ? daysUntil(nextRenewal.endDate) : null;

  return (
    <div className="flex flex-col gap-6">
      <RecordPageView id={client.id} label={client.fullName} href={`/clients/${client.id}`} type="Cliente" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={client.fullName}
          description={client.type === "COMPANY" ? "Empresa · cartera y actividad vinculada." : "Persona · cartera y actividad vinculada."}
          metadata={
            <>
              <StatusBadge status={client.status} entity="client" />
              <Badge variant="outline" className="rounded-full">{client.type === "COMPANY" ? "Empresa" : "Persona"}</Badge>
              {client.rfc ? <span className="inline-flex items-center gap-1.5"><BadgeInfo className="size-3.5" />RFC {client.rfc}</span> : null}
              {client.phone ? <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary"><Phone className="size-3.5" />{client.phone}</a> : null}
              {client.email ? <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 hover:text-primary"><Mail className="size-3.5" />{client.email}</a> : null}
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <NoraContextButton context={{ type: "client", id: client.id }} />
              <Button asChild variant="outline" className="bg-card/70">
                <Link href={`/policies?q=${encodeURIComponent(client.fullName)}`}>Ver pólizas</Link>
              </Button>
              <Button asChild variant="outline" className="bg-card/70">
                <Link href={`/clients/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              {isAdmin ? <DeleteClientButton id={id} name={client.fullName} /> : null}
              <Button asChild variant="outline" className="bg-card/70">
                <Link href={returnTo}>Volver a clientes</Link>
              </Button>
            </div>
          }
        />

        <AuditByline createdById={client.createdById} updatedById={client.updatedById} />

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <MetricCard
            title="Pólizas activas"
            value={exactPolicyStats._count._all}
            description={`Prima total ${formatCurrencyExact(activePremium)}`}
            icon={ShieldCheck}
            tone="emerald"
          />
          <MetricCard
            title="Recibos pendientes"
            value={exactReceiptCount}
            description="Pendientes de cobro, vencidos o en seguimiento."
            icon={ClipboardList}
            tone="amber"
          />
          <MetricCard
            title="Última actividad"
            value={activity[0] ? formatDate(activity[0].createdAt) : "—"}
            description={activity[0]?.action ?? "Todavía no hay actividad registrada."}
            icon={History}
            tone="blue"
          />
        </section>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
          <SectionCard title="Pólizas del cliente" description="Cartera completa. Ordenada por renovación y filtrable por estado.">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="space-y-3">
                <StatusFilterButtons
                  paramKey="policyStatus"
                  selectedValue={policyStatus ?? "ALL"}
                  options={policyStatusOptions.map((option) => ({
                    ...option,
                    count: policyStatusCounts.find((entry) => entry.status === option.value)?._count._all ?? 0,
                  }))}
                />
                <TableToolbar
                  searchPlaceholder="Buscar en pólizas..."
                  tableControls={false}
                  resultCount={policies.length}
                  totalCount={totalPolicyCount}
                  resultNoun={["póliza", "pólizas"]}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{totalPolicyCount} en total</span>
                {policyStatusOptions.map((option) => {
                  const count = policyStatusCounts.find((entry) => entry.status === option.value)?._count._all ?? 0;
                  return <span key={option.value}>{option.label}: {count}</span>;
                })}
              </div>
            </div>
            <div className="max-h-[30rem] overflow-x-hidden overflow-y-auto">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/40">
                    <TableHead>Póliza</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Objeto asegurado</TableHead>
                    <TableHead>Renovación</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                        No hay pólizas con este filtro.
                      </TableCell>
                    </TableRow>
                  ) : policies.map((policy) => {
                    const renewalDays = policy.endDate ? daysUntil(policy.endDate) : null;
                    const isRenewalSoon = policy.status === "ACTIVE" && renewalDays !== null && renewalDays >= 0 && renewalDays <= 30;
                    const insuredObject = policy.insuredAssets[0]?.description ?? "Sin objeto capturado";
                    return (
                    <TableRow key={policy.id} className={isRenewalSoon ? "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-950/20" : undefined}>
                      <TableCell>
                        <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                          <PolicyIdentity policyNumber={policy.policyNumber} policy={policy} />
                        </Link>
                      </TableCell>
                      <TableCell><StatusBadge status={policy.status} entity="policy" /></TableCell>
                      <TableCell>{policy.insurer.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full">
                          {policyTypeLabel(policy.policyType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-52 truncate" title={insuredObject}>{insuredObject}</TableCell>
                      <TableCell>
                        <span>{policy.endDate ? formatDate(policy.endDate) : "Sin fecha"}</span>
                        {isRenewalSoon ? <Badge className="ml-2 bg-amber-100 text-amber-900 hover:bg-amber-100">{renewalDays === 0 ? "Renueva hoy" : `${renewalDays} días`}</Badge> : null}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <div className="grid gap-4">
            <SectionCard
              title="Renovación próxima"
              description={nextRenewal ? `${policyTypeLabel(nextRenewal.policyType)} · póliza ${nextRenewal.policyNumber}` : "Seguimiento de vigencias activas."}
            >
              <div className="space-y-4 p-4">
                {nextRenewal?.endDate ? (
                  <>
                    <div className={nextRenewalDays !== null && nextRenewalDays <= 30
                      ? "flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                      : "flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3 text-foreground"}>
                      <CalendarDays className="size-5 shrink-0" />
                      <div>
                        <p className="font-semibold">{nextRenewalDays === 0 ? "Vence hoy" : `Vence en ${nextRenewalDays} día${nextRenewalDays === 1 ? "" : "s"}`}</p>
                        <p className="text-sm opacity-80">{formatDate(nextRenewal.endDate)}</p>
                      </div>
                    </div>
                    <Button asChild className="w-full">
                      <Link href={`/policies/${nextRenewal.id}`}>Abrir póliza</Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay renovaciones futuras registradas en las pólizas activas.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Ficha del cliente" description="Datos complementarios y administrativos.">
              <div className="p-4">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <span>Datos fiscales y de cuenta</span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-4 grid gap-4 border-t border-border/70 pt-4 text-sm sm:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Preferencia de contacto</p><p className="mt-1">{client.preferredContactMethod ?? "No capturada"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Nacimiento</p><p className="mt-1">{client.birthDate ? `${formatBirthdayDate(client.birthDate)} de ${client.birthDate.getUTCFullYear()} · ${calculateAge(client.birthDate)} años` : "Sin fecha registrada"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Dirección</p><p className="mt-1">{client.address ?? "Sin dirección"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Alta · actualizado</p><p className="mt-1">{formatDate(client.createdAt)} · {formatDate(client.updatedAt)}</p></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Referidor</p>
                      {client.referidor ? <Link href={`/clients/${client.referidor.id}`} className="mt-1 inline-flex items-center gap-2 hover:text-primary">{client.referidor.fullName}<StatusBadge status={client.referidor.status} entity="client" /></Link> : <p className="mt-1">Sin referidor</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Clientes referidos</p>
                      <p className="mt-1">{client._count.referidos} cuenta{client._count.referidos === 1 ? "" : "s"}</p>
                      {referidos.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{referidos.map((referido) => <Link key={referido.id} href={`/clients/${referido.id}`}><Badge variant="outline" className="rounded-full">{referido.fullName}</Badge></Link>)}</div> : null}
                    </div>
                    {client.notes ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Notas</p><p className="mt-1 whitespace-pre-wrap">{client.notes}</p></div> : null}
                  </div>
                </details>
              </div>
            </SectionCard>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Recibos" description="Últimos 10 movimientos; el enlace abre el historial completo." action={<Link href={`/receipts?q=${encodeURIComponent(client.fullName)}`} className="text-sm font-medium text-primary hover:underline">Ver todos</Link>}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Recibo</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                    <TableCell>
                      <Link href={`/policies/${receipt.policyId}`} className="text-foreground hover:text-primary">
                        {receipt.policy.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(receipt.dueDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={receipt.status} entity="receipt" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Tareas" description="Últimos 10 pendientes; el enlace abre la cola completa." action={<Link href={`/operations?view=pending&q=${encodeURIComponent(client.fullName)}`} className="text-sm font-medium text-primary hover:underline">Ver todas</Link>}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Folio</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Vence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workItems.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">
                      <Link href={`/tasks/${task.sourceId ?? task.id}`} className="hover:text-primary">
                        {task.folio ?? task.sourceId ?? task.id}
                      </Link>
                    </TableCell>
                    <TableCell>{task.title}</TableCell>
                    <TableCell>
                      <PriorityBadge priority={task.priority} />
                    </TableCell>
                    <TableCell>{task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <SectionCard title="Siniestros" description="Últimos 5 casos; el enlace abre todos los siniestros del cliente." action={<Link href={`/operations?view=claims&q=${encodeURIComponent(client.fullName)}`} className="text-sm font-medium text-primary hover:underline">Ver todos</Link>}>
            <div className="divide-y divide-stone-200/80">
              {claims.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No hay siniestros para este cliente todavía.</div>
              ) : (
                claims.map((claim) => (
                  <div key={claim.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/claims/${claim.id}`} className="font-medium text-foreground hover:text-primary">{claim.folio}</Link>
                      <StatusBadge status={claim.status} entity="claim" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{claim.claimType}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <Link href={`/policies/${claim.policyId}`} className="hover:text-primary">{claim.policy.policyNumber}</Link> · {claim.insurer.name} · {formatDate(claim.reportedDate)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Documentos" description="Últimos 20 documentos; el enlace abre el archivo completo." action={<Link href={`/documents?q=${encodeURIComponent(client.fullName)}`} className="text-sm font-medium text-primary hover:underline">Ver todos</Link>}>
              <div className="space-y-4 p-4">
                <DocumentDropZone
                  associations={{ clientId: id }}
                  defaultDocumentType="ID"
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
                      d.policy?.policyNumber ??
                      d.receipt?.receiptNumber ??
                      d.task?.folio ??
                      d.claim?.folio ??
                      "Cliente",
                  }))}
                />
              </div>
            </SectionCard>
          </div>
        </section>

        <SectionCard
          title="Actividad"
          description="Cambios y eventos recientes registrados para este cliente."
          action={
            <Link
              href={`/activity?entity=Client&id=${id}`}
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
                Sin actividad registrada para este cliente todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </div>
  );
  });
}
