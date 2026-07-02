"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as XLSX from "@e965/xlsx";
import { formatDateInput } from "@/lib/form-utils";

type ExportData = {
  name: string;
  data: unknown[];
};

export function ExportButtons({ exports }: { exports: ExportData[] }) {
  const [isExporting, setIsExporting] = useState(false);

  const exportToCSV = (data: unknown[], filename: string) => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0] as object);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = (row as Record<string, unknown>)[header];
            // Escape values that contain commas or quotes
            const str = String(value ?? "");
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const workbook = XLSX.utils.book_new();

      exports.forEach(({ name, data }) => {
        if (data.length > 0) {
          const worksheet = XLSX.utils.json_to_sheet(data);
          XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31)); // Excel sheet names max 31 chars
        }
      });

      XLSX.writeFile(workbook, `pg-report-${formatDateInput(new Date())}.xlsx`);
    } finally {
      setIsExporting(false);
    }
  };

  const exportSingleCSV = (exportData: ExportData) => {
    setIsExporting(true);
    try {
      exportToCSV(exportData.data, `policydesk-${exportData.name.toLowerCase().replace(/\s+/g, "-")}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="rounded-full bg-card/70" disabled={isExporting} />}
      >
        <Download className="mr-2 size-4" />
        {isExporting ? "Exportando..." : "Exportar"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={exportToExcel} disabled={isExporting}>
          <FileSpreadsheet className="mr-2 size-4" />
          Descargar Excel (.xlsx)
        </DropdownMenuItem>
        {exports.map((exp) => (
          <DropdownMenuItem
            key={exp.name}
            onSelect={() => exportSingleCSV(exp)}
            disabled={isExporting || exp.data.length === 0}
          >
            <FileText className="mr-2 size-4" />
            {exp.name} (.csv)
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
