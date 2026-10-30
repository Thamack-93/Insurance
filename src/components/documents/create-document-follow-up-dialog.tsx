"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createDocumentFollowUp } from "@/app/(dashboard)/tasks/actions";
import { businessAddDays, businessToday } from "@/lib/business-dates";
import { formatDateInput } from "@/lib/form-utils";
import { documentFollowUpHref } from "@/lib/document-follow-up";

type Props = {
  documentId: string;
  fileName: string;
  clientName: string | null;
  policyNumber: string | null;
  taskId: string | null;
  enabled: boolean;
};

export function CreateDocumentFollowUpDialog({ documentId, fileName, clientName, policyNumber, taskId, enabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ href: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultDueDate = formatDateInput(businessAddDays(businessToday(), 7));
  const taskHref = taskId ? documentFollowUpHref(taskId) : null;

  if (taskId && (!result || !open)) {
    return <Button asChild variant="outline" size="sm" className="min-h-9 whitespace-nowrap"><Link href={taskHref!}>Ver pendiente</Link></Button>;
  }
  if (!enabled) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setResult(null);
      setError(null);
    }
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const response = await createDocumentFollowUp(documentId, formData);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult({ href: response.href, message: response.message });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-9 whitespace-nowrap" />}>
        <CheckSquare className="mr-1.5 size-4" />
        Crear pendiente
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear pendiente</DialogTitle>
          <DialogDescription className="break-words">
            Desde {fileName}{clientName ? ` · ${clientName}` : ""}{policyNumber ? ` · Póliza ${policyNumber}` : ""}.
            El documento y su contexto se vincularán automáticamente.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div role="status" className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <p>{result.message}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button asChild size="sm"><Link href={result.href}>Abrir pendiente</Link></Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Seguir en Documentos</Button>
            </div>
          </div>
        ) : (
          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`follow-up-title-${documentId}`}>Título</Label>
              <Input id={`follow-up-title-${documentId}`} name="title" required minLength={3} maxLength={200} autoFocus disabled={pending} placeholder="Ej. Confirmar recepción de documentos" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`follow-up-due-${documentId}`}>Fecha límite</Label>
              <div className="relative">
                <CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id={`follow-up-due-${documentId}`} name="dueDate" type="date" required defaultValue={defaultDueDate} disabled={pending} className="pl-9" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`follow-up-notes-${documentId}`}>Notas <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea id={`follow-up-notes-${documentId}`} name="notes" maxLength={4000} disabled={pending} rows={3} />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar pendiente"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
