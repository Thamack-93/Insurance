"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeverityBadge } from "@/components/badges/status-badge";
import { notificationLink } from "@/lib/notifications-shared";
import { markNotificationRead, markAllNotificationsRead } from "@/app/(dashboard)/notifications/actions";
import { cn } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/dates";

export type BellNotification = {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string | null;
  entityType: string;
  entityId: string;
  createdAt: string;
  readAt: string | null;
};

export function NotificationsBell({
  unreadCount,
  notifications,
  isAdmin = false,
}: {
  unreadCount: number;
  notifications: BellNotification[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleMarkOne = (id: string) => {
    startTransition(async () => {
      await markNotificationRead(id);
      router.refresh();
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Ver notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""}`}
            className="relative rounded-full bg-card/75"
          >
            <Bell className="size-4" aria-hidden />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white shadow ring-2 ring-background"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] max-w-[92vw] gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Notificaciones</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount === 0
                ? "Estás al día"
                : `${unreadCount} sin leer`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMarkAll}
            disabled={isPending || unreadCount === 0}
            className="h-7 gap-1 rounded-full px-2 text-xs"
          >
            <CheckCheck className="size-3.5" aria-hidden />
            Marcar todas
          </Button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <Bell className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">Sin notificaciones</p>
              <p className="text-xs text-muted-foreground">
                Cuando haya vencimientos o riesgos, aparecerán aquí.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {notifications.map((notification) => {
                const href = notificationLink(notification.entityType, notification.entityId, isAdmin);
                const relative = formatRelativeDate(notification.createdAt);
                const isUnread = notification.readAt === null;
                return (
                  <li
                    key={notification.id}
                    className={cn("px-4 py-3", isUnread && "bg-primary/5")}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 inline-block size-2 shrink-0 rounded-full",
                          isUnread ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <Link
                          href={href}
                          onClick={() => {
                            setOpen(false);
                            if (isUnread) handleMarkOne(notification.id);
                          }}
                          className="group min-w-0 flex-1"
                      >
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              "truncate text-sm group-hover:text-primary",
                              isUnread ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
                            )}
                          >
                            {notification.title}
                          </p>
                          <SeverityBadge severity={notification.severity} />
                        </div>
                        {notification.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {notification.description}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {relative} · {notification.alertType}
                          {!isUnread ? " · Leída" : ""}
                        </p>
                      </Link>
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={() => handleMarkOne(notification.id)}
                          disabled={isPending}
                          className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                            isPending && "opacity-50",
                          )}
                          aria-label={`Marcar como leída ${notification.title}`}
                        >
                          Leída
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border/70 px-4 py-2">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="inline-flex w-full items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
