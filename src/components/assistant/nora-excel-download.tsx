"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDateInput } from "@/lib/form-utils";
import { cn } from "@/lib/utils";

const reports = [
  { type: "overdue", slug: "cobranza-vencida", title: "Cobranza vencida", description: "Recibos abiertos cuya fecha de vencimiento ya pasó.", columns: "Recibo, cliente, póliza, aseguradora, vencimiento, importe y estado" },
  { type: "renewals", slug: "renovaciones-proximas", title: "Renovaciones próximas", description: "Pólizas activas que vencen en los siguientes 30 días.", columns: "Póliza, cliente, aseguradora, ramo, vencimiento y prima" },
  { type: "portfolio", slug: "cartera-activa", title: "Cartera activa", description: "Pólizas activas dentro de tu cartera autorizada.", columns: "Póliza, cliente, aseguradora, ramo, vigencia y prima" },
] as const;

type ReportType = (typeof reports)[number]["type"];
type ReportPayload = { success: true; report: { slug: string; title: string; columns: string[]; rows: Record<string, unknown>[] } };

export function NoraExcelDownload({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<ReportType>("overdue");
  const [isDownloading, setIsDownloading] = useState(false);
  const report = reports.find((item) => item.type === selected) ?? reports[0];

  async function download() {
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/nora/reports?type=${selected}`);
      const payload = (await response.json()) as ReportPayload | { error?: string };
      if (!response.ok || !("success" in payload) || !payload.success) throw new Error("error" in payload ? payload.error : "No se pudo generar el reporte.");
      const XLSX = await import("@e965/xlsx");
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(payload.report.rows, { header: payload.report.columns });
      XLSX.utils.book_append_sheet(workbook, worksheet, payload.report.title.slice(0, 31));
      XLSX.writeFile(workbook, `policydesk-${payload.report.slug}-${formatDateInput(new Date())}.xlsx`);
      toast.success(`Reporte listo · ${payload.report.rows.length} registros`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el reporte.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size={compact ? "sm" : "default"} />}>
        <FileSpreadsheet className="size-4" />{compact ? "Excel" : "Reportes Excel"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Generar reporte con Nora</DialogTitle><DialogDescription>Revisa el alcance y las columnas antes de descargar. Los datos respetan tu cartera y no se almacenará el archivo.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {reports.map((item) => (
            <button key={item.type} type="button" onClick={() => setSelected(item.type)} className={cn("w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === item.type && "border-ai bg-ai/5")}>
              <span className="block text-sm font-medium">{item.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs font-medium">Columnas</p><p className="mt-1 text-xs text-muted-foreground">{report.columns}.</p></div>
        <DialogFooter>
          <Button type="button" onClick={download} disabled={isDownloading}>{isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Descargar Excel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
