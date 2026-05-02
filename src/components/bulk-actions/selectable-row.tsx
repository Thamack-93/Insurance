"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { useBulkActions } from "./bulk-actions-provider";

interface SelectableRowProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function SelectableRow({ id, children, className }: SelectableRowProps) {
  const { selectedItems, toggleItem } = useBulkActions();
  const isSelected = selectedItems.has(id);

  return (
    <TableRow className={className} data-selected={isSelected}>
      <TableCell className="w-4">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleItem(id)}
          aria-label={`Seleccionar fila ${id}`}
        />
      </TableCell>
      {children}
    </TableRow>
  );
}
