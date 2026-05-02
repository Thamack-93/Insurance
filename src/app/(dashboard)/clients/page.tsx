import Link from "next/link";
import { ArrowRight, Building2, FileText, Users2, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function ClientsPage() {
  const db = getDb();

  const clients = await db.client.findMany({
    include: {
      policies: { select: { premiumAmount: true, status: true } },
      receipts: { select: { status: true } },
      tasks: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const activeClients = clients.filter((client) => client.status === "ACTIVE");
  const companies = clients.filter((client) => client.type === "COMPANY");
  const topByPortfolio = clients
    .map((client) => ({
      ...client,
      activePolicies: client.policies.filter((policy) => policy.status === "ACTIVE").length,
      totalPremium: client.policies
        .filter((policy) => policy.status === "ACTIVE")
        .reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0),
      openTasks: client.tasks.filter((task) => task.status !== "RESOLVED" && task.status !== "CANCELLED" && task.status !== "ARCHIVED").length,
      openReceipts: client.receipts.filter((receipt) => receipt.status !== "PAID" && receipt.status !== "CANCELLED").length,
    }))
    .sort((a, b) => b.totalPremium - a.totalPremium)
    .slice(0, 10);

  const recentClients = clients.slice(0, 10);
  const clientsWithoutPolicies = clients.filter((client) => client.policies.length === 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Clientes"
          description="Mapa de clientes, exposición de cartera y actividad operativa asociada."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/clients/new">Nuevo cliente</Link>
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
            title="Clientes activos"
            value={activeClients.length}
            description="Base vigente con seguimiento operativo."
            icon={Users2}
            tone="blue"
          />
          <MetricCard
            title="Empresas"
            value={companies.length}
            description="Cuentas corporativas en la base."
            icon={Building2}
            tone="emerald"
          />
          <MetricCard
            title="Sin pólizas"
            value={clientsWithoutPolicies.length}
            description="Clientes que aún no tienen cartera activa."
            icon={FileText}
            tone="amber"
          />
          <MetricCard
            title="Total de clientes"
            value={clients.length}
            description="Incluye activos, inactivos y archivados."
            icon={UserRound}
            tone="rose"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <SectionCard title="Top por cartera" description="Clientes ordenados por valor de prima activa.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Pólizas</TableHead>
                  <TableHead>Recibos</TableHead>
                  <TableHead>Tareas</TableHead>
                  <TableHead className="text-right">Prima activa</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topByPortfolio.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:text-primary">
                        {client.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full">
                        {client.type === "COMPANY" ? "Empresa" : "Persona"}
                      </Badge>
                    </TableCell>
                    <TableCell>{client.activePolicies}</TableCell>
                    <TableCell>{client.openReceipts}</TableCell>
                    <TableCell>{client.openTasks}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(client.totalPremium)}</TableCell>
                    <TableCell>
                      <StatusBadge status={client.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Clientes recientes" description="Alta más reciente y señal de actividad.">
            <div className="divide-y divide-stone-200/80">
              {recentClients.map((client) => (
                <div key={client.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:text-primary">
                      {client.fullName}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {client.email ?? "Sin email"} · {client.phone ?? "Sin teléfono"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Alta {formatDate(client.createdAt)} · {client.policies.length} pólizas
                    </p>
                  </div>
                  <StatusBadge status={client.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
