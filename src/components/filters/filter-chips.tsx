"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type FilterChip = {
  id: string
  label: string
  value?: React.ReactNode
  onRemove?: () => void
}

export type FilterChipsProps = {
  items: FilterChip[]
  onClearAll?: () => void
  clearLabel?: string
  emptyLabel?: string
  className?: string
}

function FilterChips({
  items,
  onClearAll,
  clearLabel = "Limpiar filtros",
  emptyLabel = "Sin filtros activos",
  className,
}: FilterChipsProps) {
  if (!items.length) {
    return <div className={cn("text-sm text-muted-foreground", className)}>{emptyLabel}</div>
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {items.map((item) => (
        <Badge key={item.id} variant="outline" className="rounded-full border-border/70 bg-muted/40 px-3 py-1 text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">{item.label}</span>
            {item.value ? <span className="text-muted-foreground">· {item.value}</span> : null}
          </span>
          {item.onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-1 -mr-1 size-5 rounded-full text-muted-foreground hover:text-foreground"
              onClick={item.onRemove}
              aria-label={`Quitar filtro ${item.label}`}
            >
              <XIcon />
            </Button>
          ) : null}
        </Badge>
      ))}

      {onClearAll ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onClearAll}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  )
}

export { FilterChips }
