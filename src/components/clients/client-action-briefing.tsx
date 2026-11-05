import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrencyExact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CLIENT_ACTION_BRIEFING_LIMIT, hasMeaningfulClientAttention, type ClientAction, type ClientActionOverviewItem } from "@/lib/client-action-briefing.logic";

const priorityLabels: Record<ClientAction["priority"], string> = {
  OVERDUE: "Vencido",
  TODAY: "Hoy",
  UPCOMING: "Próximo",
  OPEN: "Abierto",
  ACTIVITY: "Actividad",
};

function ActionLine({ action }: { action: ClientAction }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border/70 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <Link href={action.href} className="min-w-0 rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-medium">{action.title}</span>
        {action.detail ? <span className="ml-2 text-sm text-muted-foreground">{action.detail}</span> : null}
      </Link>
      <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {action.priority !== "ACTIVITY" ? <span>{priorityLabels[action.priority]}</span> : null}
        {action.dueDate ? <time dateTime={action.dueDate.toISOString()}>{formatDate(action.dueDate)}</time> : null}
        {action.amount !== undefined && action.currency ? <span className="font-medium text-foreground">{formatCurrencyExact(action.amount, action.currency)}</span> : null}
      </span>
    </li>
  );
}

export function ClientActionBriefing({ actions }: { actions: ClientAction[] }) {
  const attention = actions.filter((action) => action.priority !== "ACTIVITY").slice(0, CLIENT_ACTION_BRIEFING_LIMIT);
  const activity = actions.filter((action) => action.priority === "ACTIVITY").slice(0, 2);

  return (
    <section aria-labelledby="client-action-briefing-title">
      <Card className="bg-card shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle id="client-action-briefing-title">Resumen de atención</CardTitle>
          <CardDescription>Prioridades y actividad reciente de este cliente.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!hasMeaningfulClientAttention(actions) ? (
            <p className="px-4 py-4 text-sm font-medium">No hay pendientes importantes</p>
          ) : (
            <ul aria-label="Pendientes prioritarios">
              {attention.map((action) => <ActionLine key={action.id} action={action} />)}
              {actions.filter((action) => action.priority !== "ACTIVITY").length > attention.length ? (
                <li className="border-b border-border/70 px-4 py-3 text-sm text-muted-foreground">
                  Hay {actions.filter((action) => action.priority !== "ACTIVITY").length - attention.length} pendientes más. Revisa las secciones de esta ficha.
                </li>
              ) : null}
            </ul>
          )}
          {activity.length ? (
            <div className="border-t border-border/70">
              <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">Actividad reciente</p>
              <ul>
                {activity.map((action) => <ActionLine key={action.id} action={action} />)}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

export function ClientActionOverview({ clients }: { clients: ClientActionOverviewItem[] }) {
  return (
    <section aria-labelledby="client-action-overview-title">
      <Card className="bg-card shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle id="client-action-overview-title">Clientes que requieren atención</CardTitle>
          <CardDescription>Abre la ficha para revisar todas sus prioridades.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {clients.length ? (
            <ul>
              {clients.map((client) => (
                <li key={client.clientId} className="border-b border-border/70 px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link href={`/clients/${client.clientId}`} className="font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {client.clientName}
                    </Link>
                    <span className="text-xs text-muted-foreground">{client.totalActions} pendiente{client.totalActions === 1 ? "" : "s"}</span>
                  </div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {client.actions.slice(0, 2).map((action) => (
                      <li key={action.id} className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={action.href} className="hover:text-primary hover:underline">{action.title}</Link>
                        <span className="text-xs text-muted-foreground">
                          {priorityLabels[action.priority]}{action.dueDate ? ` · ${formatDate(action.dueDate)}` : ""}
                          {action.amount !== undefined && action.currency ? ` · ${formatCurrencyExact(action.amount, action.currency)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">No hay pendientes importantes para clientes de tu cartera.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
