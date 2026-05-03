import Link from "next/link";
import { History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { Button } from "@/components/ui/button";
import { getAllActivity } from "@/lib/activity-log";

const PAGE_SIZE = 25;

const ENTITY_OPTIONS = [
  { value: "", label: "Todas las entidades" },
  { value: "Client", label: "Clientes" },
  { value: "Policy", label: "Pólizas" },
  { value: "Insurer", label: "Aseguradoras" },
  { value: "Receipt", label: "Recibos" },
  { value: "Claim", label: "Siniestros" },
  { value: "Quote", label: "Cotizaciones" },
  { value: "Task", label: "Tareas" },
  { value: "Payment", label: "Pagos" },
  { value: "Commission", label: "Comisiones" },
  { value: "Document", label: "Documentos" },
];

const ACTION_OPTIONS = [
  { value: "", label: "Todas las acciones" },
  { value: "CREATE", label: "Creación" },
  { value: "UPDATE", label: "Actualización" },
  { value: "DELETE", label: "Eliminación" },
  { value: "PAY", label: "Pago" },
  { value: "CANCEL", label: "Cancelación" },
  { value: "CLOSE", label: "Cierre" },
  { value: "REOPEN", label: "Reapertura" },
  { value: "RENEW", label: "Renovación" },
];

const entityLabelMap: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.filter((option) => option.value).map((option) => [option.value, option.label]),
);

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const iso = endOfDay ? `${trimmed}T23:59:59.999` : `${trimmed}T00:00:00.000`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const entityType = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  const entityId = typeof sp.id === "string" && sp.id ? sp.id : undefined;
  const action = typeof sp.action === "string" && sp.action ? sp.action : undefined;
  const fromRaw = typeof sp.from === "string" ? sp.from : undefined;
  const toRaw = typeof sp.to === "string" ? sp.to : undefined;
  const pageRaw = typeof sp.page === "string" ? Number(sp.page) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const filter = {
    entityType,
    entityId,
    action,
    from: parseDate(fromRaw),
    to: parseDate(toRaw, true),
  };

  const { entries, total } = await getAllActivity({ filter, page, pageSize: PAGE_SIZE });

  const filterParams = {
    entity: entityType ?? "",
    id: entityId ?? "",
    action: action ?? "",
    from: fromRaw ?? "",
    to: toRaw ?? "",
  };

  const filterContext = entityType
    ? `Filtrando ${entityLabelMap[entityType] ?? entityType}${entityId ? ` · ${entityId}` : ""}`
    : "Mostrando toda la actividad del sistema.";

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          eyebrow="Auditoría"
          title="Actividad del sistema"
          description="Historial cronológico de cambios, pagos, creaciones y eliminaciones."
          actions={
            <Button asChild variant="outline" className="rounded-full bg-card/70">
              <Link href="/dashboard">Volver al panel</Link>
            </Button>
          }
        />

        <SectionCard title="Filtros" description={filterContext}>
          <form
            method="get"
            className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          >
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-entity">Entidad</label>
              <select
                id="filter-entity"
                name="entity"
                defaultValue={entityType ?? ""}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              >
                {ENTITY_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-action">Acción</label>
              <select
                id="filter-action"
                name="action"
                defaultValue={action ?? ""}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              >
                {ACTION_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-from">Desde</label>
              <input
                id="filter-from"
                type="date"
                name="from"
                defaultValue={fromRaw ?? ""}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="filter-to">Hasta</label>
              <input
                id="filter-to"
                type="date"
                name="to"
                defaultValue={toRaw ?? ""}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              />
            </div>
            {entityId ? <input type="hidden" name="id" value={entityId} /> : null}
            <div className="flex items-end gap-2">
              <Button type="submit" className="h-9 rounded-full">
                Aplicar
              </Button>
              <Button
                asChild
                type="button"
                variant="outline"
                className="h-9 rounded-full bg-card/70"
              >
                <Link href="/activity">Limpiar</Link>
              </Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Línea de tiempo"
          description={total > 0 ? `${total} eventos coinciden con los filtros.` : undefined}
        >
          {entries.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={History}
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
    </main>
  );
}
