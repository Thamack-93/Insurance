import Link from "next/link";
import { ArrowRight, Bell, CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { SeverityBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  notificationLink,
  getAllNotifications,
  getNotificationTypes,
  type NotificationFilter,
} from "@/lib/notifications";
import { MarkOneButton, MarkAllReadButton } from "@/components/notifications/notifications-page-actions";
import { formatDate, formatRelativeDate } from "@/lib/dates";

const PAGE_SIZE = 25;

const READ_OPTIONS: Array<{ value: "all" | "unread" | "read"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "unread", label: "No leídas" },
  { value: "read", label: "Leídas" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; read?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const type = (params.type ?? "").trim() || undefined;
  const readParam = (params.read ?? "").trim();
  const read: NotificationFilter["read"] =
    readParam === "read" || readParam === "unread" ? readParam : "all";
  const page = Math.max(1, Number(params.page) || 1);

  const filter: NotificationFilter = { type, read };

  const [{ entries, total }, types] = await Promise.all([
    getAllNotifications({ filter, page, pageSize: PAGE_SIZE }),
    getNotificationTypes(),
  ]);

  const filterParams = {
    type: type ?? "",
    read,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notificaciones"
        title="Bandeja de notificaciones"
        description="Notificaciones operativas: vencimientos, renovaciones, calidad y seguimientos."
        actions={
          <>
            <MarkAllReadButton />
            <Button asChild variant="outline" className="rounded-full bg-card/70">
              <Link href="/risks">
                Ver riesgos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard title="Filtros" description={`${total} notificación${total === 1 ? "" : "es"} encontradas.`}>
        <form method="get" className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label htmlFor="filter-type">Tipo</label>
            <select
              id="filter-type"
              name="type"
              defaultValue={type ?? ""}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="">Todos los tipos</option>
              {types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label htmlFor="filter-read">Estado</label>
            <select
              id="filter-read"
              name="read"
              defaultValue={read}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              {READ_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="outline" className="rounded-full bg-card/70">
              Aplicar
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Notificaciones" description="Las más recientes primero.">
        {entries.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              icon={Bell}
              title="Sin notificaciones"
              description="Cuando el motor de riesgos detecte vencimientos o se generen pendientes urgentes, aparecerán aquí."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {entries.map((notification) => {
              const href = notificationLink(notification.entityType, notification.entityId);
              const isRead = Boolean(notification.readAt);
              const relative = formatRelativeDate(notification.createdAt);
              return (
                <li
                  key={notification.id}
                  className="flex items-start justify-between gap-4 px-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isRead ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full bg-red-600"
                        />
                      ) : null}
                      <Link href={href} className="font-medium text-foreground hover:text-primary">
                        {notification.title}
                      </Link>
                      <SeverityBadge severity={notification.severity} />
                      <Badge variant="outline" className="rounded-full text-xs">
                        {notification.alertType}
                      </Badge>
                    </div>
                    {notification.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{notification.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {relative} · {formatDate(notification.createdAt)} · {notification.entityType}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button asChild variant="outline" size="sm" className="rounded-full">
                      <Link href={href}>Abrir</Link>
                    </Button>
                    {!isRead ? (
                      <MarkOneButton id={notification.id} />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCheck className="size-3" /> Leída
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/notifications"
          searchParams={filterParams}
        />
      </SectionCard>
    </div>
  );
}
