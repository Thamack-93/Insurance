import Link from "next/link";
import { ArrowRight, Calculator, Clock, FileText, Plus, TrendingUp, CheckCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";

export default async function QuotesPage() {
  const db = getDb();

  const quotes = await db.quote.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      insurer: true,
    },
  });

  const activeQuotes = quotes.filter((q) => q.status !== "EXPIRED" && q.status !== "CANCELLED" && q.status !== "REJECTED");
  const pendingQuotes = quotes.filter((q) => q.status === "REQUESTED" || q.status === "IN_PROGRESS");
  const sentQuotes = quotes.filter((q) => q.status === "SENT");
  const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED");
  const expiredQuotes = quotes.filter((q) => q.status === "EXPIRED");

  const totalValue = quotes.reduce((sum, q) => sum + Number(q.quotedAmount ?? 0), 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title="Cotizaciones"
          description="Seguimiento de propuestas, cotizaciones activas y tasas de conversión."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/quotes/new">
                  <Plus className="mr-2 size-4" />
                  Nueva cotización
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/policies">
                  Ver pólizas
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Activas"
            value={activeQuotes.length}
            description={`${pendingQuotes.length} pendientes · ${sentQuotes.length} enviadas`}
            icon={Calculator}
            tone="blue"
          />
          <MetricCard
            title="Aceptadas"
            value={acceptedQuotes.length}
            description="Convertidas a póliza."
            icon={CheckCircle}
            tone="emerald"
          />
          <MetricCard
            title="Valor total"
            value={formatCurrency(totalValue)}
            description="Suma de primas cotizadas."
            icon={TrendingUp}
            tone="amber"
          />
          <MetricCard
            title="Expiradas"
            value={expiredQuotes.length}
            description="Fuera de vigencia."
            icon={Clock}
            tone="rose"
          />
        </section>

        <SectionCard title="Cotizaciones recientes" description="Listado completo de propuestas.">
          {quotes.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No hay cotizaciones registradas.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Folio</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.slice(0, 20).map((quote) => (
                  <TableRow key={quote.id}>
                    <TableCell>
                      <Link
                        href={`/quotes/${quote.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {quote.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>{quote.client.fullName}</TableCell>
                    <TableCell>{quote.policyType}</TableCell>
                    <TableCell>{quote.insurer?.name ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={quote.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDate(quote.createdAt)}
                        <span className="text-xs">({daysSince(quote.createdAt)} d)</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {quote.quotedAmount ? formatCurrency(quote.quotedAmount) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {quotes.length > 20 && (
            <div className="border-t border-stone-200/80 px-4 py-3 text-center text-sm text-muted-foreground">
              Mostrando 20 de {quotes.length} cotizaciones
            </div>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="Pendientes de envío" description="Cotizaciones en preparación.">
            {pendingQuotes.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay cotizaciones pendientes.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {pendingQuotes.slice(0, 5).map((quote) => (
                  <div key={quote.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary">
                        {quote.id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {quote.client.fullName} · {quote.policyType}
                      </p>
                    </div>
                    <StatusBadge status={quote.status} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Enviadas recientemente" description="Esperando respuesta del cliente.">
            {sentQuotes.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay cotizaciones enviadas.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {sentQuotes.slice(0, 5).map((quote) => (
                  <div key={quote.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary">
                        {quote.id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {quote.client.fullName}
                        {quote.validUntil && ` · Vence: ${formatDate(quote.validUntil)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {quote.quotedAmount && (
                        <p className="text-sm font-medium">{formatCurrency(quote.quotedAmount)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
