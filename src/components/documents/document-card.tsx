"use client"

import { DownloadIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react"

import { StatusBadge } from "@/components/badges/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type DocumentCardMeta = {
  label: string
  value: React.ReactNode
}

export type DocumentCardProps = {
  title: string
  description?: string
  status?: string
  meta?: DocumentCardMeta[]
  onOpen?: () => void
  onDownload?: () => void
  openLabel?: string
  downloadLabel?: string
  className?: string
}

function DocumentCard({
  title,
  description,
  status,
  meta = [],
  onOpen,
  onDownload,
  openLabel = "Abrir",
  downloadLabel = "Descargar",
  className,
}: DocumentCardProps) {
  return (
    <Card data-motion-target="lift" className={cn("transition-all hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none", className)}>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground ring-1 ring-foreground/10">
              <FileTextIcon className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="truncate text-base">{title}</CardTitle>
              {description ? <CardDescription className="line-clamp-2">{description}</CardDescription> : null}
            </div>
          </div>
          {status ? <StatusBadge status={status} /> : null}
        </div>
      </CardHeader>

      {meta.length ? (
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {meta.map((item) => (
              <div key={item.label} className="rounded-md border bg-muted/30 p-2.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-sm text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      ) : null}

      {(onOpen || onDownload) && (
        <CardFooter className="flex items-center justify-end gap-2">
          {onDownload ? (
            <Button type="button" variant="outline" size="sm" onClick={onDownload} className="gap-1.5">
              <DownloadIcon className="size-4" />
              {downloadLabel}
            </Button>
          ) : null}
          {onOpen ? (
            <Button type="button" size="sm" onClick={onOpen} className="gap-1.5">
              <ExternalLinkIcon className="size-4" />
              {openLabel}
            </Button>
          ) : null}
        </CardFooter>
      )}
    </Card>
  )
}

export { DocumentCard }
