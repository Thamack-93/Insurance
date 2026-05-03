import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordPageView } from "@/components/recently-viewed/record-page-view";
import { Mail, Phone, MapPin, BadgeInfo, FileText, ClipboardList, History, Pencil, ShieldCheck } from "lucide-react";
import { DeleteClientButton } from "@/components/clients/delete-client-button";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

const quoteStatusLabels: Record<string, string> = {
  REQUESTED: "Solicitada",
  IN_PROGRESS: "En proceso",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const client = await db.client.findUnique({
    where: { id },
  });

  if (!client) {
    notFound();
  }

  const [policies, receipts, tasks, claims, quotes, documents, activity] = await Promise.all([
    db.policy.findMany({
      where: { clientId: id },
      include: { insurer: true },
      orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
      take: 10,
    }),
    db.receipt.findMany({
      where: { clientId: id },
      include: { policy: true, insurer: true },
      orderBy: { dueDate: "desc" },
      take: 10,
    }),
    db.task.findMany({
      where: { clientId: id },
      include: { policy: true, insurer: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 10,
    }),
    db.claim.findMany({
      where: { clientId: id },
      include: { policy: true, insurer: true },
      orderBy: { reportedDate: "desc" },
      take: 5,
    }),
    db.quote.findMany({
      where: { clientId: id },
      include: { insurer: true },
      orderBy: { requestedDate: "desc" },
      take: 5,
    }),
    db.document.findMany({
      where: { clientId: id },
      include: { policy: true, receipt: true, task: true, claim: true, quote: true },
      orderBy: { uploadedAt: "desc" },
      take: 8,
    }),
    getActivityForEntity("Client", id, 20),
  ]);

  const activePolicies = policies.filter((policy) => policy.status === "ACTIVE");
  const openReceipts = receipts.filter((receipt) => receipt.status !== "PAID" && receipt.status !== "CANCELLED");
  const openTasks = tasks.filter((task) => task.status !== "RESOLVED" && task.status !== "CANCELLED" && task.status !== "ARCHIVED");
  const activePremium = activePolicies.reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <RecordPageView id={client.id} label={client.fullName} href={`/clients/${client.id}`} type="Cliente" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={client.fullName}
          description={`${client.type === "COMPANY" ? "Empresa" : "Persona"} · expediente central del cliente y su actividad vinculada.`}
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/clients/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeleteClientButton id={id} name={client.fullName} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/clients">Volver a clientes</Link>
              </Button>
            </div>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Pólizas activas"
            value={activePolicies.length}
            description={formatCurrency(activePremium)}
            icon={ShieldCheck}
            tone="emerald"
          />
          <MetricCard
            title="Recibos abiertos"
            value={openReceipts.length}
            description="Pendientes de cobro, vencidos o en seguimiento."
            icon={ClipboardList}
            tone="amber"
          />
          <MetricCard
            title="Tareas abiertas"
            value={openTasks.length}
            description="Pendientes operativos relacionados."
            icon={BadgeInfo}
            tone="blue"
          />
          <MetricCard
            title="Documentos"
            value={documents.length}
            description="Expediente local vinculado al cliente."
            icon={FileText}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <SectionCard title="Ficha del cliente" description="Datos de contacto y contexto básico.">
            <div className="grid gap-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <StatusBadge status={client.status} />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Alta {formatDate(client.createdAt)} · Actualizado {formatDate(client.updatedAt)}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {client.type === "COMPANY" ? "Empresa" : "Persona"}
                </Badge>
              </div>
              <div className="grid gap-3 text-sm">
                <div className="flex items-center gap-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <span>{client.email ?? "Sin email"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="size-4 text-muted-foreground" />
                  <span>{client.phone ?? "Sin teléfono"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span>{client.address ?? "Sin dirección"}</span>
                </div>
              </div>
              <SectionCard title="Datos fiscales y contacto">
                <div className="space-y-3 px-4 py-3 text-sm text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">Preferencia de contacto</p>
                    <p className="mt-1">{client.preferredContactMethod ?? "No capturada"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">RFC</p>
                    <p className="mt-1">{client.rfc ?? "No capturado"}</p>
                  </div>
                </div>
              </SectionCard>
              {client.notes ? <p className="text-sm text-muted-foreground">{client.notes}</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="Pólizas" description="Cartera de este cliente, de la más viva a la más cercana.">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Renovación</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                        {policy.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{policy.insurer.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full">
                        {policy.policyType}
                      </Badge>
                    </TableCell>
                    <TableCell>{policy.renewalDate ? formatDate(policy.renewalDate) : "Sin fecha"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Recibos" description="Cobranza histórica y pendientes.">
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
                      <StatusBadge status={receipt.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Tareas" description="Pendientes que cuelgan del cliente.">
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
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.folio}</TableCell>
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
          <SectionCard title="Siniestros" description="Casos abiertos o resueltos vinculados al cliente.">
            <div className="divide-y divide-stone-200/80">
              {claims.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No hay siniestros para este cliente todavía.</div>
              ) : (
                claims.map((claim) => (
                  <div key={claim.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{claim.folio}</p>
                      <StatusBadge status={claim.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{claim.claimType}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {claim.policy.policyNumber} · {claim.insurer.name} · {formatDate(claim.reportedDate)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Cotizaciones" description="Expediente comercial.">
              <div className="divide-y divide-stone-200/80">
                {quotes.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">Sin cotizaciones registradas.</div>
                ) : (
                  quotes.map((quote) => (
                    <div key={quote.id} className="px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">{quote.policyType}</p>
                        <Badge variant="outline" className="rounded-full">
                          {quoteStatusLabels[quote.status] ?? quote.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {quote.insurer?.name ?? "Sin aseguradora"} · {formatDate(quote.requestedDate)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="Documentos" description="Archivo local del cliente.">
              <div className="divide-y divide-stone-200/80">
                {documents.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">Sin documentos asociados.</div>
                ) : (
                  documents.map((document) => (
                    <div key={document.id} className="px-4 py-4">
                      <p className="font-medium text-foreground">{document.fileName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {document.documentType} · {formatDate(document.uploadedAt)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {document.policy?.policyNumber ?? document.receipt?.receiptNumber ?? document.task?.folio ?? document.claim?.folio ?? document.quote?.id ?? "Sin asociación"}
                      </p>
                    </div>
                  ))
                )}
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
              <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 size-5 text-muted-foreground" />
                Sin actividad registrada para este cliente todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </main>
  );
}
