"use client";

import { useState } from "react";
import { Download, Eye, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateInput } from "@/lib/form-utils";

export type DownloadableReportType = "overdue" | "renewals" | "portfolio" | "commissions" | "operations";

type Option = { label: string; value: string };

export type ReportDownloadDefinition = {
  type: DownloadableReportType;
  title: string;
  description: string;
  dateLabel: string;
  defaultFrom: string;
  defaultTo: string;
  filterLabel: string;
  defaultFilter: string;
  filterOptions: Option[];
};

type ReportPayload = {
  success: true;
  report: {
    slug: string;
    title: string;
    columns: string[];
    rows: Record<string, unknown>[];
    totalCount: number;
    returnedCount: number;
    nextCursor: string | null;
  };
};

export function ReportDownloadCard({ definition }: { definition: ReportDownloadDefinition }) {
  const [from, setFrom] = useState(definition.defaultFrom);
  const [to, setTo] = useState(definition.defaultTo);
  const [filter, setFilter] = useState(definition.defaultFilter);
  const [preview, setPreview] = useState<ReportPayload["report"] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);

  async function loadReport(cursorValue?: string) {
    const query = new URLSearchParams({ type: definition.type, from, to, filter });
    if (cursorValue) query.set("cursor", cursorValue);
    query.set("pageSize", "100");
    const response = await fetch(`/api/nora/reports?${query.toString()}`);
    const payload = (await response.json().catch(() => null)) as ReportPayload | { error?: string } | null;
    if (!response.ok || !payload || !("success" in payload) || !payload.success) {
      throw new Error(payload && "error" in payload ? payload.error : "No se pudo generar el reporte.");
    }
    return payload.report;
  }

  async function showPreview() {
    setBusy("preview");
    try {
      const report = await loadReport();
      setPreview(report);
      setCursor(undefined);
      setPreviousCursors([]);
      toast.success(`Vista previa lista · ${report.returnedCount} de ${report.totalCount} registros`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar la vista previa.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    try {
      const report = preview ?? await loadReport();
      setPreview(report);
      const XLSX = await import("@e965/xlsx");
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(report.rows, { header: report.columns });
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, report.columns.length - 1))}${Math.max(1, report.rows.length + 1)}` };
      XLSX.utils.book_append_sheet(workbook, worksheet, report.title.slice(0, 31));
      XLSX.writeFile(workbook, `policydesk-${report.slug}-${formatDateInput(new Date())}.xlsx`);
      toast.success(`Página descargada · ${report.returnedCount} de ${report.totalCount} registros`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo descargar el reporte.");
    } finally {
      setBusy(null);
    }
  }

  async function goToPage(next: string | undefined, previous: boolean) {
    setBusy("preview");
    try {
      const report = await loadReport(next);
      setPreview(report);
      if (previous) {
        setPreviousCursors((current) => current.slice(0, -1));
      } else {
        setPreviousCursors((current) => [...current, cursor]);
      }
      setCursor(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar de página.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="report-generator-title">
      <header className="border-b px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><FileSpreadsheet className="size-5" aria-hidden /></span>
          <div>
            <h2 id="report-generator-title" className="font-semibold">{definition.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <form className="grid content-start gap-4 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1.5 text-sm font-medium">
            Desde
            <Input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPreview(null); }} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Hasta
            <Input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPreview(null); }} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            {definition.filterLabel}
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setPreview(null); }} className="min-h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {definition.filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{definition.dateLabel}. El archivo sólo incluirá registros autorizados de tu cartera.</p>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={showPreview} disabled={busy !== null || !from || !to}>
              {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}Vista previa
            </Button>
            <Button type="button" onClick={download} disabled={busy !== null || !from || !to || !preview}>
              {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Descargar Excel
            </Button>
          </div>
        </form>

        <div className="min-w-0 rounded-md border bg-muted/25 p-4" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contenido del documento</p>
          {preview ? (
            <>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{preview.returnedCount}</p>
              <p className="text-xs text-muted-foreground">registros listos para descargar; de {preview.totalCount} totales, se muestra una página de 100</p>
              {preview.nextCursor || previousCursors.length ? (
                <div className="mt-4 flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null || previousCursors.length === 0} onClick={() => goToPage(previousCursors.at(-1), true)}>Anterior</Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null || !preview.nextCursor} onClick={() => goToPage(preview.nextCursor ?? undefined, false)}>Siguiente</Button>
                </div>
              ) : null}
              {preview.nextCursor ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">La descarga actual corresponde sólo a esta página.</p> : null}
              <div className="mt-4 flex flex-wrap gap-1.5">{preview.columns.map((column) => <span key={column} className="rounded-md border bg-background px-2 py-1 text-[11px]">{column}</span>)}</div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Ajusta los filtros y genera una vista previa para comprobar filas y columnas antes de descargar.</p>
          )}
        </div>
      </div>
    </section>
  );
}
