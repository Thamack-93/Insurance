import Link from "next/link";
import { ArrowRight, FileUp, Plus, Shield, CalendarClock, AlertCircle, BadgeDollarSign, FolderKanban } from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { PoliciesListTable } from "@/components/policies/policies-list-table";
import { TableEmptyState } from "@/components/tables/table-empty-state";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { getDb } from "@/lib/db";
import { businessAddDays } from "@/lib/business-dates";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { policyStatusOptions, policyTypeOptions } from "@/lib/domain-options";
import { policyOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import { buildTableHref } from "@/lib/table-query";
import {
  buildPolicyListOrderBy,
  buildPolicyListWhere,
  readPolicyListFilters,
} from "@/lib/list-filters";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { policyNavigation } from "@/lib/navigation";

const PAGE_SIZE = 25;
const policyStatusFilterOptions = policyStatusOptions.map((option) =>
  option.value === "EXPIRED" ? { ...option, label: "Vigencia terminada" } : option,
);

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string; status?: string; type?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const filters = readPolicyListFilters(params);
  const { query, page, sortKey, direction } = filters;
  const statusFilter = filters.status;
  const typeFilter = filters.type;
  const isFiltered = Boolean(query || statusFilter || typeFilter);

  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = today();
  const in60 = businessAddDays(now, 60);
  const portfolioWhere = policyOperationalWhere(scope.portfolioOwnerId);
  const renewals60Promise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
    },
    scope.portfolioOwnerId,
  );
  const renewalRiskPoliciesPromise = loadEligibleRenewalPolicies(
    { endDate: { lt: now } },
    scope.portfolioOwnerId,
  );

  const where = buildPolicyListWhere(filters, scope.portfolioOwnerId);
  const orderBy = buildPolicyListOrderBy(filters);
  const clearFiltersHref = buildTableHref("/policies", params, {
    q: null,
    status: null,
    type: null,
    page: null,
  });

  const [
    activeCount,
    pendingCount,
    renewals60Policies,
    renewalRiskPolicies,
    portfolioAgg,
    totalCount,
    filteredCount,
    pagedPolicies,
    pendingPolicies,
  ] = await Promise.all([
    db.policy.count({ where: { ...portfolioWhere, status: "ACTIVE" } }),
    db.policy.count({ where: { ...portfolioWhere, status: "PENDING" } }),
    renewals60Promise,
    renewalRiskPoliciesPromise,
    db.policy.aggregate({
      where: { ...portfolioWhere, status: "ACTIVE" },
      _sum: { premiumAmount: true },
    }),
    db.policy.count({ where: portfolioWhere }),
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.policy.findMany({
      where: { ...portfolioWhere, status: "PENDING" },
      include: { client: true, insurer: true },
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: 10,
    }),
  ]);

  const renewalRiskCount = renewalRiskPolicies.length;
  const attentionPolicies = [...renewalRiskPolicies, ...pendingPolicies]
    .sort((left, right) => left.endDate.getTime() - right.endDate.getTime())
    .slice(0, 10);

  const portfolioValue = toNumber(portfolioAgg._sum.premiumAmount ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Pólizas"
          description="Inventario vivo de pólizas, con foco en estado, valor y renovación."
          actions={
            <>
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/policies/new">
                  <Plus className="mr-2 size-4" />
                  Nueva póliza
                </Link>
              </Button>
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/policies/capture">
                  <FileUp className="mr-2 size-4" />
                  Capturar PDF
                </Link>
              </Button>
              <Button asChild>
                <Link href="/portfolio">
                  Cartera
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <LocalNavigation
          label="Vistas de pólizas"
          items={policyNavigation}
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Pólizas activas"
            value={activeCount}
            description={formatCurrency(portfolioValue)}
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Renovaciones 60 días"
            value={renewals60Policies.length}
            description="Pólizas activas con ventana de seguimiento."
            icon={CalendarClock}
            tone="amber"
          />
          <MetricCard
            title="Pendientes"
            value={pendingCount}
            description="Pólizas en captación o por finalizar."
            icon={BadgeDollarSign}
            tone="blue"
          />
          <Link
            href="/operations?view=renewals"
            aria-label={`Renovaciones vencidas sin resolver: ${renewalRiskCount}`}
            className="block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
          >
            <MetricCard
              title="Renovaciones vencidas sin resolver"
              value={renewalRiskCount}
              description="Pólizas activas vencidas sin renovación ni decisión registrada."
              icon={AlertCircle}
              tone="rose"
            />
          </Link>
        </section>

        <SectionCard
          title="Inventario"
          description={
            statusFilter === "EXPIRED"
              ? "Vigencias terminadas para consulta histórica; esto no indica por sí solo que una renovación haya quedado sin resolver."
              : "Búsqueda y paginación sobre todas las pólizas."
          }
          action={
            <TableToolbar
              searchPlaceholder="Buscar por número, cliente, aseguradora, prima o fecha..."
              resultCount={filteredCount}
              totalCount={totalCount}
              resultNoun={["póliza", "pólizas"]}
              exportDataset="policies"
              filters={[
                {
                  key: "status",
                  label: "Estado",
                  options: policyStatusFilterOptions,
                },
                {
                  key: "type",
                  label: "Tipo",
                  options: policyTypeOptions,
                },
              ]}
            />
          }
        >
          {filteredCount === 0 ? (
            <TableEmptyState
              icon={FolderKanban}
              isFiltered={isFiltered}
              clearHref={clearFiltersHref}
              noun="pólizas"
              query={query}
              emptyTitle="Aún no hay pólizas"
              emptyDescription="Registra tu primera póliza para construir el inventario."
              emptyAction={{ label: "Nueva póliza", href: "/policies/new" }}
            />
          ) : pagedPolicies.length === 0 ? (
            <div className="p-4">
                <EmptyState
                  icon={FolderKanban}
                  title="Página fuera de rango"
                  description="No hay pólizas en esta página. Vuelve al inicio del listado."
                  action={{ label: "Volver al inicio", href: buildTableHref("/policies", params, { q: query || null, status: statusFilter || null, type: typeFilter || null, }) }}
                />
              </div>
          ) : (
            <PoliciesListTable
              policies={pagedPolicies.map((policy) => ({
                id: policy.id,
                policyNumber: policy.policyNumber,
                clientId: policy.clientId,
                clientName: policy.client.fullName,
                insurerName: policy.insurer.name,
                policyType: policy.policyType,
                status: policy.status,
                currency: policy.currency,
                premiumAmount: toNumber(policy.premiumAmount),
                endDateLabel: policy.endDate
                  ? statusFilter === "EXPIRED"
                    ? `Terminó: ${formatDate(policy.endDate)}`
                    : formatDate(policy.endDate)
                  : "",
                daysToRenewal: statusFilter === "EXPIRED" ? null : policy.endDate ? daysUntil(policy.endDate) : null,
              }))}
              page={page}
              pageSize={PAGE_SIZE}
              total={filteredCount}
              historical={statusFilter === "EXPIRED"}
              canBulkEdit
              searchParams={{
                q: query,
                status: statusFilter ?? undefined,
                type: typeFilter ?? undefined,
                sort: sortKey ?? undefined,
                dir: direction ?? undefined,
              }}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Atención inmediata"
          description="Renovaciones sin resolver y pólizas pendientes que conviene mover esta semana."
        >
          {attentionPolicies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Shield}
                title="Cartera al día"
                description="No hay renovaciones vencidas sin resolver ni pólizas pendientes que reclamen atención inmediata."
              />
            </div>
          ) : (
            <div className="divide-y divide-stone-200/80">
              {attentionPolicies.map((policy) => (
                <div key={policy.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link
                      href={`/policies/${policy.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {policy.policyNumber}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {policy.client.fullName} · {policy.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {policy.endDate ? formatDate(policy.endDate) : "Sin renovación"} · {policyTypeLabel(policy.policyType)}
                    </p>
                  </div>
                  <StatusBadge status={policy.status} entity="policy" className="w-fit" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
