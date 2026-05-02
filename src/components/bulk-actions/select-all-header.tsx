"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { TableHead } from "@/components/ui/table";
import { useBulkActions } from "./bulk-actions-provider";

interface SelectAllHeaderProps {
  ids: string[];
}

export function SelectAllHeader({ ids }: SelectAllHeaderProps) {
  const { selectedItems, selectAll, clearSelection } = useBulkActions();
  
  const allSelected = ids.length > 0 && ids.every((id) => selectedItems.has(id));
  const someSelected = ids.some((id) => selectedItems.has(id)) && !allSelected;

  return (
    <TableHead className="w-4">
      <Checkbox
        checked={allSelected}
        data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
        onCheckedChange={(checked) => {
          if (checked) {
            selectAll(ids);
          } else {
            clearSelection();
          }
        }}
        aria-label="Seleccionar todas las filas"
      />
    </TableHead>
  );
}
