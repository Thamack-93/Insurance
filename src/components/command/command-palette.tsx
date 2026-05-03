"use client"

import * as React from "react"
import { SearchIcon } from "lucide-react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

export type CommandPaletteItem = {
  id: string
  label: string
  description?: string
  shortcut?: string
  icon?: React.ReactNode
  onSelect?: () => void
  disabled?: boolean
}

export type CommandPaletteGroup = {
  label: string
  items: CommandPaletteItem[]
}

export type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: CommandPaletteGroup[]
  title?: string
  description?: string
  placeholder?: string
  className?: string
  inputValue?: string
  onInputValueChange?: (value: string) => void
  shouldFilter?: boolean
}

function CommandPalette({
  open,
  onOpenChange,
  groups,
  title = "Búsqueda global",
  description = "Busca páginas, acciones y accesos rápidos.",
  placeholder = "Escribe para buscar...",
  className,
  inputValue,
  onInputValueChange,
  shouldFilter = true,
}: CommandPaletteProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={title} description={description} className={className}>
      <Command shouldFilter={shouldFilter}>
        <CommandInput placeholder={placeholder} value={inputValue} onValueChange={onInputValueChange} />
        <CommandList>
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-2">
              <SearchIcon className="size-5 text-muted-foreground" />
              <span>No se encontraron coincidencias.</span>
            </div>
          </CommandEmpty>
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.label}>
              <CommandGroup heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    disabled={item.disabled}
                    onSelect={item.onSelect}
                    className={cn("data-selected:bg-muted/80")}
                  >
                    {item.icon ? <span className="text-muted-foreground">{item.icon}</span> : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{item.label}</span>
                      {item.description ? (
                        <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                      ) : null}
                    </span>
                    {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
              {groupIndex < groups.length - 1 ? <CommandSeparator /> : null}
            </React.Fragment>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

const GlobalSearch = CommandPalette

export { CommandPalette, GlobalSearch }
