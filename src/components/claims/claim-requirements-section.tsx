"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/pages-secondary/panels";
import { formatDate } from "@/lib/dates";
import { CLAIM_CHECKLIST_STATUSES, CLAIM_CHECKLIST_STATUS_LABELS, isClaimChecklistPending, type ClaimChecklistStatusValue } from "@/lib/claim-checklist-values";
import { formatClaimDocumentRequest, manualClaimWhatsAppLink } from "@/lib/claim-document-request";
import { createClaimRequirement, deleteClaimRequirement, setClaimRequirementDocument, updateClaimRequirementStatus } from "@/app/(dashboard)/claims/actions";

type Requirement = {
  id: string;
  requirementCode: string;
  label: string;
  status: ClaimChecklistStatusValue;
  requestedAt: string | null;
  receivedAt: string | null;
  waivedAt: string | null;
  updatedAt: string;
  version: number;
  documentId: string | null;
};

type ClaimDocument = { id: string; fileName: string };

function stateDate(item: Requirement) {
  if (item.status === "REQUESTED") return item.requestedAt;
  if (item.status === "RECEIVED") return item.receivedAt;
  if (item.status === "WAIVED") return item.waivedAt;
  return null;
}

export function ClaimRequirementsSection({ claimId, claimStatus, items, documents }: { claimId: string; claimStatus: string; items: Requirement[]; documents: ClaimDocument[] }) {
  const [label, setLabel] = useState("");
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestPhone, setRequestPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const terminal = claimStatus === "RESOLVED" || claimStatus === "CANCELLED";
  const pendingCount = items.filter((item) => isClaimChecklistPending(item.status)).length;
  const receivedCount = items.filter((item) => item.status === "RECEIVED").length;

  const run = (action: () => Promise<{ ok: boolean; message?: string; error?: string }>) => startTransition(async () => {
    const result = await action();
    if (!result.ok) toast.error(result.error);
    else toast.success(result.message);
  });

  const add = () => {
    if (!label.trim()) return;
    run(async () => {
      const result = await createClaimRequirement(claimId, label);
      if (result.ok) setLabel("");
      return result;
    });
  };

  return (
    <SectionCard title="Requisitos del siniestro" description={`${pendingCount} pendientes · ${receivedCount} recibidos`}>
      <div className="space-y-3 p-4">
        {terminal ? <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Siniestro cerrado: los requisitos son de solo lectura.</p> : (
          <div className="flex gap-2">
            <Input value={label} onChange={(event) => setLabel(event.target.value.slice(0, 200))} placeholder="Ej. Factura o identificación" aria-label="Nuevo requisito" maxLength={200} />
            <Button type="button" onClick={add} disabled={pending || !label.trim()}>Agregar requisito</Button>
          </div>
        )}
        {items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Sin requisitos guardados. Agrega el primero para comenzar el seguimiento.</p> : (
          <div className="divide-y rounded-lg border">
            {items.map((item) => {
              const date = stateDate(item);
              return <div key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{date ? `${CLAIM_CHECKLIST_STATUS_LABELS[item.status]} · ${formatDate(new Date(date))}` : CLAIM_CHECKLIST_STATUS_LABELS[item.status]}</p>{item.documentId ? <p className="text-xs text-muted-foreground">Documento: {documents.find((doc) => doc.id === item.documentId)?.fileName ?? "Vinculado"}</p> : null}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} />
                  {!terminal ? <select aria-label={`Estado de ${item.label}`} value={item.status} disabled={pending} onChange={(event) => run(() => updateClaimRequirementStatus({ claimId, itemId: item.id, status: event.target.value as ClaimChecklistStatusValue, expectedUpdatedAt: item.updatedAt, expectedVersion: item.version }))} className="h-9 rounded-md border bg-background px-2 text-sm">{CLAIM_CHECKLIST_STATUSES.map((status) => <option key={status} value={status}>{CLAIM_CHECKLIST_STATUS_LABELS[status]}</option>)}</select> : null}
                  {!terminal && item.status === "RECEIVED" && documents.length > 0 ? <select aria-label={`Documento de ${item.label}`} value={item.documentId ?? ""} disabled={pending} onChange={(event) => run(() => setClaimRequirementDocument({ claimId, itemId: item.id, documentId: event.target.value || null, expectedUpdatedAt: item.updatedAt }))} className="h-9 max-w-48 rounded-md border bg-background px-2 text-sm"><option value="">Sin documento</option>{documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.fileName}</option>)}</select> : null}
                  {!terminal && item.requirementCode.startsWith("CUSTOM:") ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { if (window.confirm(`¿Eliminar el requisito "${item.label}"?`)) run(() => deleteClaimRequirement({ claimId, itemId: item.id, expectedUpdatedAt: item.updatedAt })); }}>Eliminar</Button> : null}
                </div>
              </div>;
            })}
          </div>
        )}
        <div className="space-y-3 rounded-lg border p-3" aria-label="Solicitud manual de documentos">
          <div>
            <h3 className="text-sm font-semibold">Solicitar documentos pendientes</h3>
            <p className="text-xs text-muted-foreground">Prepara y revisa el mensaje. No se envía automáticamente.</p>
          </div>
          <Button type="button" variant="outline" disabled={!pendingCount} onClick={() => setRequestMessage(formatClaimDocumentRequest({ clientName: "", claimReference: claimId, outstandingDocuments: items.filter((item) => isClaimChecklistPending(item.status)).map((item) => item.label) }))}>
            Preparar mensaje
          </Button>
          {requestMessage !== null ? (
            <div className="space-y-2">
              <label htmlFor="claim-document-message" className="block text-sm font-medium">Mensaje editable</label>
              <textarea id="claim-document-message" rows={7} maxLength={4000} className="w-full rounded-md border bg-background p-3 text-sm" value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} />
              <label htmlFor="claim-document-phone" className="block text-sm font-medium">Teléfono con código de país (para WhatsApp)</label>
              <Input id="claim-document-phone" type="tel" autoComplete="off" placeholder="+52 55 1234 5678" value={requestPhone} onChange={(event) => setRequestPhone(event.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!requestMessage.trim()} onClick={async () => {
                  try { await navigator.clipboard.writeText(requestMessage); toast.success("Mensaje copiado"); }
                  catch { toast.error("No se pudo copiar. Selecciona el texto manualmente."); }
                }}>Copiar mensaje</Button>
                {manualClaimWhatsAppLink(requestPhone, requestMessage) ? (
                  <Button asChild type="button" variant="outline"><a href={manualClaimWhatsAppLink(requestPhone, requestMessage) ?? "#"} target="_blank" rel="noopener noreferrer">Abrir WhatsApp (sin enviar)</a></Button>
                ) : <span className="self-center text-xs text-muted-foreground">Ingresa un teléfono válido para abrir WhatsApp.</span>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
