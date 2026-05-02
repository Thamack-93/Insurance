"use client";

import { Trash2, Download, FileEdit, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBulkActions } from "./bulk-actions-provider";

interface BulkActionsToolbarProps {
  onDelete?: () => void;
  onExport?: () => void;
  onStatusChange?: (status: string) => void;
  statusOptions?: { value: string; label: string }[];
}

export function BulkActionsToolbar({
  onDelete,
  onExport,
  onStatusChange,
  statusOptions,
}: BulkActionsToolbarProps) {
  const { hasSelection, selectedItems, clearSelection, getSelectedIds } = useBulkActions();

  if (!hasSelection) {
    return null;
  }

  const selectedCount = selectedItems.size;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-stone-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="rounded-full">
          {selectedCount} seleccionados
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearSelection}
          className="h-8 gap-1 text-muted-foreground"
        >
          <X className="size-3" />
          Limpiar
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {statusOptions && onStatusChange && (
          <div className="flex items-center gap-1">
            {statusOptions.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                size="sm"
                onClick={() => onStatusChange(option.value)}
                className="h-8"
              >
                <FileEdit className="mr-1 size-3" />
                {option.label}
              </Button>
            ))}
          </div>
        )}

        {onExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            className="h-8"
          >
            <Download className="mr-1 size-3" />
            Exportar
          </Button>
        )}

        {onDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            className="h-8"
          >
            <Trash2 className="mr-1 size-3" />
            Eliminar
          </Button>
        )}
      </div>
    </div>
  );
}
