import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Ban,
  History,
  KeyRound,
  Siren,
  ShieldAlert,
  TimerReset,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { Button } from "@/components/ui/button";
import { getAllActivity } from "@/lib/activity-log";
import { AuthError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 25;

type ActivityView = {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  actionStartsWith?: string;
  highlight?: string;
};

const ACTIVITY_VIEWS: ActivityView[] = [
  {
    value: "all",
    label: "Toda la actividad",
    description: "Historial completo del sistema.",
    icon: History,
    highlight: "bg-card/85",
  },
  {
    value: "security",
    label: "Seguridad",
    description: "Eventos de seguridad y auditoría.",
    icon: ShieldAlert,
    actionStartsWith: "SECURITY_",
    highlight: "bg-rose-50/70 dark:bg-rose-950/20",
  },
  {
    value: "denied",
    label: "Accesos denegados",
    description: "Bloqueos por rol, cartera o documento.",
    icon: Ban,
    actionStartsWith: "SECURITY_ACCESS_DENIED",
    highlight: "bg-rose-50/70 dark:bg-rose-950/20",
  },
  {
    value: "rate-limits",
    label: "Rate limits",
    description: "Intentos frenados por abuso o exceso.",
    icon: TimerReset,
    actionStartsWith: "SECURITY_RATE_LIMITED",
    highlight: "bg-amber-50/70 dark:bg-amber-950/20",
  },
  {
    value: "invalid-secrets",
    label: "Secrets inválidos",
    description: "Firmas o secretos rechazados.",
    icon: KeyRound,
    actionStartsWith: "SECURITY_INVALID_SECRET",
    highlight: "bg-amber-50/70 dark:bg-amber-950/20",
  },
  {
    value: "mutations-blocked",
    label: "Cambios reales bloqueados",
    description: "Cambios frenados por same-origin o CSRF.",
    icon: Siren,
    actionStartsWith: "SECURITY_SAME_ORIGIN_BLOCKED",
    highlight: "bg-sky-50/70 dark:bg-sky-950/20",
  },
];

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const iso = endOfDay ? `${trimmed}T23:59:59.999` : `${trimmed}T00:00:00.000`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildBaseWhere({
  entityType,
  entityId,
  from,
  to,
}: {
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}) {
  const where: Prisma.ActivityLogWhereInput = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  return where;
}

function buildViewHref(
  view: string,
  params: { entity?: string; id?: string; from?: string; to?: string; action?: string },
) {
  const query = new URLSearchParams();
  query.set("view", view);
  if (params.entity) query.set("entity", params.entity);
  if (params.id) query.set("id", params.id);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.action) query.set("action", params.action);
  const qs = query.toString();
  return qs ? `/activity?${qs}` : "/activity";
}

function getViewMeta(value: string) {
  return ACTIVITY_VIEWS.find((view) => view.value === value) ?? ACTIVITY_VIEWS[0];
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/dashboard");
    }
    throw error;
  }
  if (user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const requestedView = typeof sp.view === "string" ? sp.view : "all";
  const selectedView = getViewMeta(requestedView);
  const entityType = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  const entityId = typeof sp.id === "string" && sp.id ? sp.id : undefined;
  const action = typeof sp.action === "string" && sp.action ? sp.action : undefined;
  const fromRaw = typeof sp.from === "string" ? sp.from : undefined;
  const toRaw = typeof sp.to === "string" ? sp.to : undefined;
  const pageRaw = typeof sp.page === "string" ? Number(sp.page) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const from = parseDate(fromRaw);
  const to = parseDate(toRaw, true);
  const baseWhere = buildBaseWhere({ entityType, entityId, from, to });
  const db = getDb();

  const filter = {
    entityType,
    entityId,
    action,
    actionStartsWith: selectedView.actionStartsWith,
    from,
    to,
  };

  const [activity, total, summary] = await Promise.all([
    getAllActivity({ filter, page, pageSize: PAGE_SIZE }),
    db.activityLog.count({ where: baseWhere }),
    Promise.all(
      ACTIVITY_VIEWS.map(async (view) => ({
        view: view.value,
        count: await db.activityLog.count({
          where: {
            ...baseWhere,
            ...(view.actionStartsWith ? { action: { startsWith: view.actionStartsWith } } : {}),
          },
        }),
      })),
    ),
  ]);

  const { entries } = activity;
  const summaryCounts = Object.fromEntries(summary.map(({ view, count }) => [view, count]));
  const selectedCount = summaryCounts[selectedView.value] ?? total;
  const filterContext = [
    selectedView.value !== "all" ? selectedView.description : "Mostrando toda la actividad del sistema.",
    entityType ? `Entidad ${entityType}${entityId ? ` · ${entityId}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const filterParams = {
    view: selectedView.value,
    entity: entityType ?? "",
    id: entityId ?? "",
    action: action ?? "",
    from: fromRaw ?? "",
    to: toRaw ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Auditoría"
          title="Actividad y seguridad"
          description="Historial cronológico y panel de seguridad con vistas rápidas."
          actions={
            <Button asChild variant="outline" className="rounded-full bg-card/70">
              <Link href="/dashboard">Volver al panel</Link>
            </Button>
          }
        />

        <SectionCard title="Cuadros de revisión" description={filterContext || undefined}>
          <div className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
            {ACTIVITY_VIEWS.map((view) => {
              const Icon = view.icon;
              const href = buildViewHref(view.value, {
                entity: entityType,
                id: entityId,
                from: fromRaw,
                to: toRaw,
                action,
              });
              const isSelected = selectedView.value === view.value;
              const count = summaryCounts[view.value] ?? 0;

              return (
                <Link
                  key={view.value}
                  href={href}
                  className={cn(
                    "flex min-h-28 flex-col justify-between rounded-2xl border px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                    view.highlight,
                    isSelected ? "border-primary ring-2 ring-primary/15" : "border-border/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{view.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{view.description}</p>
                    </div>
                    <span className="rounded-full border border-border/70 bg-card/90 p-2 text-muted-foreground shadow-sm">
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-3xl font-semibold tracking-tight text-foreground">{count}</p>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                        {isSelected ? "Vista activa" : "Abrir vista"}
                      </p>
                    </div>
                    {isSelected ? (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        Seleccionado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        Ver
                        <ArrowRight className="size-3.5" />
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Rango de fechas" description="Mantiene la vista actual y filtra por fechas sin usar menús desplegables.">
          <form
            method="get"
            className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_1fr_auto_auto]"
          >
            <input type="hidden" name="view" value={selectedView.value} />
            {entityType ? <input type="hidden" name="entity" value={entityType} /> : null}
            {entityId ? <input type="hidden" name="id" value={entityId} /> : null}
            {action ? <input type="hidden" name="action" value={action} /> : null}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-from">Desde</label>
              <input
                id="filter-from"
                type="date"
                name="from"
                defaultValue={fromRaw ?? ""}
                className="h-10 rounded-md border border-border bg-card px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-to">Hasta</label>
              <input
                id="filter-to"
                type="date"
                name="to"
                defaultValue={toRaw ?? ""}
                className="h-10 rounded-md border border-border bg-card px-3 text-sm"
              />
            </div>
            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit" className="h-10 rounded-full">
                Aplicar
              </Button>
              <Button asChild type="button" variant="outline" className="h-10 rounded-full bg-card/70">
                <Link href="/activity">Limpiar</Link>
              </Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Línea de tiempo"
          description={selectedCount > 0 ? `${selectedCount} eventos coinciden con esta vista.` : "No hay eventos para esta vista."}
        >
          {entries.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Activity}
                title="Sin eventos"
                description="No hay actividad que coincida con los filtros seleccionados."
              />
            </div>
          ) : (
            <ActivityTimeline entries={entries} showEntity />
          )}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/activity"
            searchParams={filterParams}
          />
        </SectionCard>
      </div>
    </div>
  );
}
