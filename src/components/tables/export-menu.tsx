"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportFormat = "csv" | "xlsx";

export type ExportMenuProps = {
  /** Key of a dataset registered in `src/lib/export-datasets.ts`. */
  dataset: string;
  /** Search params to send. Defaults to whatever the current URL carries. */
  paramKeys?: string[];
  label?: string;
};

function fileNameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) return decodeURIComponent(utf8[1]);

  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : fallback;
}

/**
 * Downloads the full filtered result set from the server instead of scraping
 * the rendered page, which only ever contained the visible rows.
 */
export function ExportMenu({ dataset, paramKeys, label = "Exportar" }: ExportMenuProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);

  async function download(format: ExportFormat) {
    const params = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      if (key === "page") continue;
      if (paramKeys && !paramKeys.includes(key)) continue;
      params.append(key, value);
    }
    params.set("format", format);

    setPendingFormat(format);

    try {
      const response = await fetch(`/api/export/${dataset}?${params.toString()}`);

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? "No se pudo generar la exportación.");
      }

      const blob = await response.blob();
      const fallbackName = `${pathname.split("/").filter(Boolean).join("-") || "tabla"}.${format}`;
      const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackName);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      const rows = response.headers.get("X-Export-Rows");
      const truncated = response.headers.get("X-Export-Truncated") === "1";

      toast.success(
        truncated
          ? `Se exportaron los primeros ${rows} registros. Afina los filtros para bajar el resto.`
          : `Se exportaron ${rows ?? "los"} registros del filtro actual.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar la exportación.");
    } finally {
      setPendingFormat(null);
    }
  }

  const isPending = pendingFormat !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={isPending} />}
      >
        {isPending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Download className="mr-2 size-4" />
        )}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Descargar resultado completo</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void download("csv")} disabled={isPending}>
            <FileText className="mr-2 size-4" />
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void download("xlsx")} disabled={isPending}>
            <FileSpreadsheet className="mr-2 size-4" />
            Excel (.xlsx)
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
