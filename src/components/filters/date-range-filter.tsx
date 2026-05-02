"use client"

import * as React from "react"
import { format, isValid, parseISO } from "date-fns"
import { CalendarDaysIcon, CheckIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export type DateRangeValue = {
  from: string
  to: string
}

export type DateRangeFilterProps = {
  label?: string
  value?: DateRangeValue
  defaultValue?: DateRangeValue
  onChange?: (value: DateRangeValue) => void
  className?: string
}

const emptyRange: DateRangeValue = {
  from: "",
  to: "",
}

function formatDateLabel(value: string) {
  if (!value) return ""

  const parsed = parseISO(value)
  if (!isValid(parsed)) return value

  return format(parsed, "dd/MM/yyyy")
}

function summarizeRange(range: DateRangeValue) {
  const from = formatDateLabel(range.from)
  const to = formatDateLabel(range.to)

  if (from && to) return `${from} - ${to}`
  if (from) return `Desde ${from}`
  if (to) return `Hasta ${to}`

  return ""
}

function DateRangeFilter({
  label = "Rango de fechas",
  value,
  defaultValue,
  onChange,
  className,
}: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState<DateRangeValue>(defaultValue ?? emptyRange)
  const isControlled = value !== undefined
  const selectedValue = isControlled ? value : internalValue
  const [draft, setDraft] = React.useState<DateRangeValue>(selectedValue)

  const hasSelection = Boolean(selectedValue.from || selectedValue.to)

  function updateDraft(key: keyof DateRangeValue, nextValue: string) {
    setDraft((current) => ({
      ...current,
      [key]: nextValue,
    }))
  }

  function applyChanges() {
    if (!isControlled) {
      setInternalValue(draft)
    }

    onChange?.(draft)
    setOpen(false)
  }

  function resetRange() {
    setDraft(emptyRange)

    if (!isControlled) {
      setInternalValue(emptyRange)
    }

    onChange?.(emptyRange)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraft(selectedValue)
        }

        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn("justify-between gap-2", className)}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarDaysIcon className="size-4 text-muted-foreground" />
              <span>{hasSelection ? summarizeRange(selectedValue) : label}</span>
            </span>
            {hasSelection ? <CheckIcon className="size-4 text-emerald-600" /> : null}
          </Button>
        }
      />
      <PopoverContent align="start" sideOffset={8} className="w-80 p-4">
        <div className="space-y-3">
          <div>
            <div className="font-heading text-sm font-medium text-foreground">{label}</div>
            <p className="text-xs text-muted-foreground">Selecciona un inicio y un fin para filtrar los resultados.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Desde</span>
              <Input
                type="date"
                value={draft.from}
                onChange={(event) => updateDraft("from", event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hasta</span>
              <Input
                type="date"
                value={draft.to}
                onChange={(event) => updateDraft("to", event.target.value)}
              />
            </label>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetRange} className="gap-1.5">
              <RotateCcwIcon className="size-4" />
              Limpiar
            </Button>
            <Button type="button" size="sm" onClick={applyChanges}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DateRangeFilter }
