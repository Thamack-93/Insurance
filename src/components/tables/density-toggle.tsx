"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { TableDensity } from "./data-table"

export type DensityToggleProps = {
  value: TableDensity
  onValueChange: (value: TableDensity) => void
  className?: string
}

const densityOptions: Array<{ value: TableDensity; label: string }> = [
  { value: "compact", label: "Compacto" },
  { value: "comfortable", label: "Normal" },
  { value: "spacious", label: "Amplio" },
]

function DensityToggle({ value, onValueChange, className }: DensityToggleProps) {
  return (
    <div className={cn("inline-flex items-center rounded-lg border bg-background p-1 shadow-sm", className)}>
      {densityOptions.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? "default" : "ghost"}
          className={cn(
            "h-7 rounded-md px-3 text-xs",
            value === option.value ? "shadow-sm" : "text-muted-foreground"
          )}
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

export { DensityToggle }
