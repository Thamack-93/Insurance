"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FileUp, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ControlledSelect } from "@/components/forms/form-primitives";
import { Badge } from "@/components/ui/badge";
import { CommandPalette, type CommandPaletteGroup } from "@/components/command/command-palette";
import { clientTypeOptions, currencyOptions, paymentFrequencyOptions, policyTypeOptions } from "@/lib/domain-options";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  buildPolicyPdfCaptureReceiptPlan,
  inferClientType,
  normalizePdfPaymentFrequencyLabel,
  mergePolicyPdfCaptureReceiptPlan,
  type PolicyPdfCaptureReceiptPlanItem,
  type PolicyPdfCaptureDraft,
  type PolicyPdfCaptureFieldConfidence,
  type PolicyPdfCapturePreview,
} from "@/lib/policy-pdf-capture.shared";
import { extractPdfTextFromFile } from "@/lib/pdf-text-extraction.browser";
import type { PolicyCaptureSearchItem, PolicyCaptureSearchKind } from "@/lib/policy-capture-search";
import { consumePolicyCaptureHandoff, savePolicyCaptureHandoff, clearPolicyCaptureHandoff } from "@/lib/nora-browser-session";

type PreviewResponse = {
  success?: boolean;
  preview?: PolicyPdfCapturePreview;
  error?: string;
};

type ConfirmResponse = {
  success?: boolean;
  redirectTo?: string;
  message?: string;
  error?: string;
};

type InlineClientResponse = {
  success?: boolean;
  client?: {
    id: string;
    label: string;
    type: string;
    email?: string | null;
    phone?: string | null;
    rfc?: string | null;
    address?: string | null;
    birthDate?: string | null;
    reused?: boolean;
  };
  error?: string;
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;
function createEmptyDraft(): PolicyPdfCaptureDraft {
  return {
    policyNumber: "",
    clientName: "",
    clientType: "PERSON",
    clientEmail: null,
    clientPhone: null,
    clientAddress: null,
    clientRfc: null,
    clientBirthDate: null,
    insurerName: "",
    policyType: "AUTO",
    serialNumber: null,
    startDate: "",
    endDate: "",
    issueDate: null,
    paymentFrequency: "ANNUAL",
    paymentPlan: null,
    premiumAmount: 0,
    currency: "MXN",
    requestNumber: null,
    insuredObject: null,
    beneficiaryInfo: null,
    notes: null,
    sourcePolicyNumber: null,
  };
}

function createEmptyConfidence(): PolicyPdfCaptureFieldConfidence {
  return {
    policyNumber: "low",
    clientName: "low",
    clientType: "low",
    clientEmail: "low",
    clientPhone: "low",
    clientAddress: "low",
    clientRfc: "low",
    clientBirthDate: "low",
    insurerName: "low",
    policyType: "low",
    serialNumber: "low",
    startDate: "low",
    endDate: "low",
    issueDate: "low",
    paymentFrequency: "low",
    premiumAmount: "low",
    sourcePolicyNumber: "low",
  };
}

async function readJsonResponse<T>(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    const message = body.includes("<!DOCTYPE")
      ? "El servidor devolvió HTML inesperado. Recarga la página e inténtalo de nuevo."
      : "El servidor devolvió una respuesta inesperada. Recarga la página e inténtalo de nuevo.";
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function itemToCommandItem(item: PolicyCaptureSearchItem, onSelect: () => void) {
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    searchValue: item.searchValue,
    onSelect,
  };
}

function fieldConfidenceBadge(confidence: "high" | "medium" | "low") {
  if (confidence === "high") return null;
  return (
    <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-[10px] uppercase tracking-wide text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
      Revisar
    </Badge>
  );
}

export function PolicyPdfCapturePanel({ userId }: { userId: string }) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCreatingClient, startCreateClientTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PolicyPdfCapturePreview | null>(null);
  const [draft, setDraft] = useState<PolicyPdfCaptureDraft | null>(null);
  const [receiptPlanOverrides, setReceiptPlanOverrides] = useState<PolicyPdfCaptureReceiptPlanItem[]>([]);
  const [fieldConfidence, setFieldConfidence] = useState<PolicyPdfCaptureFieldConfidence>(createEmptyConfidence());
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedClientLabel, setSelectedClientLabel] = useState("");
  const [selectedInsurerId, setSelectedInsurerId] = useState("");
  const [selectedInsurerLabel, setSelectedInsurerLabel] = useState("");
  const [selectedSourcePolicyId, setSelectedSourcePolicyId] = useState("");
  const [selectedSourcePolicyLabel, setSelectedSourcePolicyLabel] = useState("");
  const [showInlineClient, setShowInlineClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupKind, setLookupKind] = useState<PolicyCaptureSearchKind | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupItems, setLookupItems] = useState<PolicyCaptureSearchItem[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  const receiptPlan = useMemo(
    () => (draft ? mergePolicyPdfCaptureReceiptPlan(draft, receiptPlanOverrides) : []),
    [draft, receiptPlanOverrides],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = consumePolicyCaptureHandoff(userId);
      const payload = stored?.payload;

      if (payload?.draft) {
        const restoredDraft = payload.draft as unknown as PolicyPdfCaptureDraft;
        setDraft(restoredDraft);
        setReceiptPlanOverrides(
          payload.receiptPlan?.length ? payload.receiptPlan as PolicyPdfCaptureReceiptPlanItem[] : buildPolicyPdfCaptureReceiptPlan(restoredDraft),
        );
        setFieldConfidence((payload.fieldConfidence as PolicyPdfCaptureFieldConfidence | undefined) ?? createEmptyConfidence());
        setSelectedClientId(payload.selectedClientId ?? "");
        setSelectedClientLabel(payload.selectedClientLabel ?? restoredDraft.clientName ?? "");
        setSelectedInsurerId(payload.selectedInsurerId ?? "");
        setSelectedInsurerLabel(payload.selectedInsurerLabel ?? restoredDraft.insurerName ?? "");
        setSelectedSourcePolicyId(payload.selectedSourcePolicyId ?? "");
        setSelectedSourcePolicyLabel(payload.selectedSourcePolicyLabel ?? restoredDraft.sourcePolicyNumber ?? "");
        setShowInlineClient(Boolean(payload.showInlineClient));
      }
      setHasHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!hasHydrated) return;
    const hasContent =
      Boolean(draft?.policyNumber) ||
      Boolean(draft?.clientName) ||
      Boolean(draft?.insurerName) ||
      Boolean(selectedClientId) ||
      Boolean(selectedInsurerId) ||
      Boolean(selectedSourcePolicyId) ||
      Boolean(showInlineClient) ||
      receiptPlan.length > 0;

    if (!hasContent || !draft) {
      clearPolicyCaptureHandoff(userId);
      return;
    }

    savePolicyCaptureHandoff(userId, {
        draft,
        fieldConfidence,
        selectedClientId,
        selectedClientLabel,
        selectedInsurerId,
        selectedInsurerLabel,
        selectedSourcePolicyId,
        selectedSourcePolicyLabel,
        showInlineClient,
        receiptPlan,
    });
  }, [
    draft,
    fieldConfidence,
    hasHydrated,
    selectedClientId,
    selectedClientLabel,
    selectedInsurerId,
    selectedInsurerLabel,
    selectedSourcePolicyId,
    selectedSourcePolicyLabel,
    showInlineClient,
    receiptPlan,
    userId,
  ]);

  useEffect(() => {
    if (!lookupOpen || !lookupKind) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLookupLoading(true);
      setLookupError(null);
      try {
        const url = new URL("/api/policies/capture/lookup", window.location.origin);
        url.searchParams.set("kind", lookupKind);
        url.searchParams.set("q", lookupQuery);
        if (lookupKind === "policy") {
          if (selectedClientId) url.searchParams.set("clientId", selectedClientId);
          if (selectedInsurerId) url.searchParams.set("insurerId", selectedInsurerId);
        }
        const response = await fetch(url.toString(), { signal: controller.signal });
        const result = await readJsonResponse<{ items: PolicyCaptureSearchItem[] }>(response);
        if (!response.ok) {
          throw new Error((result as { error?: string }).error || "No se pudo buscar en la base.");
        }
        setLookupItems(result.items ?? []);
      } catch (lookupFetchError) {
        if (controller.signal.aborted) return;
        const message = lookupFetchError instanceof Error ? lookupFetchError.message : "No se pudo buscar en la base.";
        setLookupError(message);
        setLookupItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setLookupLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [lookupKind, lookupOpen, lookupQuery, selectedClientId, selectedInsurerId]);

  const previewSummary = draft
    ? [
      draft.policyNumber || "Sin número",
      draft.clientName || "Sin cliente",
      draft.insurerName || "Sin aseguradora",
      normalizePdfPaymentFrequencyLabel(draft.paymentFrequency),
      draft.sourcePolicyNumber || "Sin origen",
    ]
    : null;

  function updateDraft(next: Partial<PolicyPdfCaptureDraft>) {
    setDraft((current) => {
      const base = current ?? createEmptyDraft();
      return { ...base, ...next };
    });
  }

  function updateReceiptAmount(receiptNumber: string, value: string) {
    setReceiptPlanOverrides((current) =>
      current.map((item) =>
        item.receiptNumber === receiptNumber ? { ...item, amount: Number(value || 0) } : item,
      ),
    );
  }

  const receiptPlanTotal = receiptPlan.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);

  function markFieldConfidence(field: keyof PolicyPdfCaptureFieldConfidence) {
    setFieldConfidence((current) => ({ ...current, [field]: "high" }));
  }

  function resetLookupState() {
    setLookupOpen(false);
    setLookupKind(null);
    setLookupQuery("");
    setLookupItems([]);
    setLookupLoading(false);
    setLookupError(null);
  }

  function openLookup(kind: PolicyCaptureSearchKind) {
    setLookupKind(kind);
    setLookupQuery(
      kind === "client"
        ? draft?.clientName ?? selectedClientLabel
        : kind === "insurer"
          ? draft?.insurerName ?? selectedInsurerLabel
          : draft?.sourcePolicyNumber ?? selectedSourcePolicyLabel,
    );
    setLookupOpen(true);
  }

  function applyLookupItem(kind: PolicyCaptureSearchKind, item: PolicyCaptureSearchItem) {
    if (!draft) return;

    if (kind === "client") {
      setSelectedClientId(item.id);
      setSelectedClientLabel(item.label);
      setSelectedSourcePolicyId("");
      setSelectedSourcePolicyLabel("");
      setShowInlineClient(false);
      updateDraft({
        clientName: item.meta?.clientType ? item.label : item.label,
        clientType: (item.meta?.clientType as PolicyPdfCaptureDraft["clientType"] | undefined) ?? inferClientType(item.label, item.meta?.rfc ?? null),
        clientEmail: item.meta?.email ?? null,
        clientPhone: item.meta?.phone ?? null,
        clientAddress: item.meta?.address ?? null,
        clientRfc: item.meta?.rfc ?? null,
        clientBirthDate: null,
        sourcePolicyNumber: null,
      });
      setFieldConfidence((current) => ({ ...current, clientName: "high", clientType: "high", clientEmail: item.meta?.email ? "high" : "low", clientPhone: item.meta?.phone ? "high" : "low", clientAddress: item.meta?.address ? "high" : "low", clientRfc: item.meta?.rfc ? "high" : "low", clientBirthDate: "low" }));
    } else if (kind === "insurer") {
      setSelectedInsurerId(item.id);
      setSelectedInsurerLabel(item.label);
      setSelectedSourcePolicyId("");
      setSelectedSourcePolicyLabel("");
      updateDraft({
        insurerName: item.label,
        sourcePolicyNumber: null,
      });
      setFieldConfidence((current) => ({ ...current, insurerName: "high" }));
    } else {
      setSelectedSourcePolicyId(item.id);
      setSelectedSourcePolicyLabel(item.label);
      setShowInlineClient(false);
      updateDraft({
        sourcePolicyNumber: item.meta?.policyNumber ?? item.label,
      });
      if (item.meta?.clientId) {
        setSelectedClientId(item.meta.clientId);
        setSelectedClientLabel(item.meta.clientName ?? item.meta.clientId);
      }
      if (item.meta?.insurerId) {
        setSelectedInsurerId(item.meta.insurerId);
        setSelectedInsurerLabel(item.meta.insurerName ?? item.meta.insurerId);
      }
      if (item.meta?.clientName) {
        updateDraft({
          clientName: item.meta.clientName,
          clientType: inferClientType(item.meta.clientName, draft.clientRfc),
        });
      }
      if (item.meta?.insurerName) {
        updateDraft({ insurerName: item.meta.insurerName });
      }
      setFieldConfidence((current) => ({ ...current, sourcePolicyNumber: item.meta?.policyNumber ? "high" : "medium" }));
    }

    resetLookupState();
  }

  async function analyzeFile() {
    if (!file) {
      setError("Selecciona un PDF para analizar.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError("El PDF supera el tamaño máximo de 10 MB.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setPreview(null);

    try {
      const extractedText = await extractPdfTextFromFile(file);
      if (!extractedText.trim()) {
        throw new Error("El PDF no tiene texto extraíble. Puede ser una imagen, un escaneo o un archivo sin capa de texto.");
      }

      const response = await fetch("/api/policies/capture/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: extractedText,
          fileName: file.name,
        }),
      });

      const result = await readJsonResponse<PreviewResponse>(response);
      if (!response.ok || !result.preview) {
        throw new Error(result.error || "No se pudo analizar el PDF.");
      }

      setPreview(result.preview);
      setDraft(result.preview.draft);
      setReceiptPlanOverrides(
        result.preview.receiptPlan?.length
          ? result.preview.receiptPlan
          : buildPolicyPdfCaptureReceiptPlan(result.preview.draft),
      );
      setFieldConfidence(result.preview.fieldConfidence ?? createEmptyConfidence());
      setSelectedClientId(result.preview.suggestions.clientId ?? "");
      setSelectedClientLabel(result.preview.draft.clientName);
      setSelectedInsurerId(result.preview.suggestions.insurerId ?? "");
      setSelectedInsurerLabel(result.preview.draft.insurerName);
      setSelectedSourcePolicyId(result.preview.suggestions.sourcePolicyId ?? "");
      setSelectedSourcePolicyLabel(result.preview.suggestions.sourcePolicyId ? result.preview.draft.sourcePolicyNumber ?? "" : "");
      setShowInlineClient(!result.preview.suggestions.clientId);
      toast.success("PDF analizado. Revisa la propuesta y confirma.");
    } catch (analysisError) {
      const message = analysisError instanceof Error ? analysisError.message : "No se pudo analizar el PDF.";
      setError(message);
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function createInlineClient() {
    if (!draft) return;
    if (!draft.clientName.trim()) {
      toast.error("Escribe el nombre del cliente antes de crear el expediente.");
      return;
    }

    startCreateClientTransition(async () => {
      try {
        const response = await fetch("/api/policies/capture/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: draft.clientName,
            type: draft.clientType || inferClientType(draft.clientName, draft.clientRfc),
            email: draft.clientEmail ?? "",
            phone: draft.clientPhone ?? "",
            address: draft.clientAddress ?? "",
            rfc: draft.clientRfc ?? "",
            birthDate: draft.clientBirthDate ?? "",
          }),
        });

        const result = await readJsonResponse<InlineClientResponse>(response);
        if (!response.ok || !result.success || !result.client) {
          throw new Error(result.error || "No se pudo crear el cliente.");
        }
        const createdClient = result.client;

        setSelectedClientId(createdClient.id);
        setSelectedClientLabel(createdClient.label);
        setShowInlineClient(false);
        updateDraft({
          clientName: createdClient.label,
          clientType: (createdClient.type as PolicyPdfCaptureDraft["clientType"]) ?? draft.clientType,
          clientEmail: createdClient.email ?? null,
          clientPhone: createdClient.phone ?? null,
          clientAddress: createdClient.address ?? null,
          clientRfc: createdClient.rfc ?? null,
          clientBirthDate: createdClient.birthDate ?? draft.clientBirthDate ?? null,
        });
        setFieldConfidence((current) => ({ ...current, clientName: "high", clientType: "high", clientEmail: createdClient.email ? "high" : current.clientEmail, clientPhone: createdClient.phone ? "high" : current.clientPhone, clientAddress: createdClient.address ? "high" : current.clientAddress, clientRfc: createdClient.rfc ? "high" : current.clientRfc, clientBirthDate: current.clientBirthDate }));
        toast.success(createdClient.reused ? "Cliente existente reutilizado." : "Cliente creado y seleccionado.");
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : "No se pudo crear el cliente.";
        toast.error(message);
        setError(message);
      }
    });
  }

  async function confirmCapture() {
    if (!draft) {
      setError("Primero analiza el PDF.");
      return;
    }
    if (!selectedClientId) {
      setError("Selecciona o crea el cliente antes de confirmar.");
      return;
    }
    if (!selectedInsurerId) {
      setError("Selecciona la aseguradora antes de confirmar.");
      return;
    }
    if (!selectedSourcePolicyId) {
      setError("Selecciona la póliza origen antes de confirmar.");
      return;
    }

    setError(null);
    setIsConfirming(true);
    try {
      const response = await fetch("/api/policies/capture/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          clientId: selectedClientId,
          insurerId: selectedInsurerId,
          sourcePolicyId: selectedSourcePolicyId,
          receiptPlan: receiptPlan.map((item) => ({
            receiptNumber: item.receiptNumber,
            amount: item.amount,
          })),
        }),
      });

      const result = await readJsonResponse<ConfirmResponse>(response);
      if (!response.ok || !result.success || !result.redirectTo) {
        throw new Error(result.error || "No se pudo confirmar la captura.");
      }

      toast.success(result.message || "Póliza capturada.");
      clearPolicyCaptureHandoff(userId);
      router.push(result.redirectTo);
      router.refresh();
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : "No se pudo confirmar la captura.";
      setError(message);
      toast.error(message);
    } finally {
      setIsConfirming(false);
    }
  }

  function clearAll() {
    setFile(null);
    setPreview(null);
    setDraft(null);
    setFieldConfidence(createEmptyConfidence());
    setSelectedClientId("");
    setSelectedClientLabel("");
    setSelectedInsurerId("");
    setSelectedInsurerLabel("");
    setSelectedSourcePolicyId("");
    setSelectedSourcePolicyLabel("");
    setShowInlineClient(false);
    setReceiptPlanOverrides([]);
    setError(null);
    resetLookupState();
    clearPolicyCaptureHandoff(userId);
  }

  const lookupGroups = (() => {
    const mappedItems = lookupItems.map((item) => itemToCommandItem(item, () => applyLookupItem(lookupKind ?? "client", item)));
    const groups: CommandPaletteGroup[] = [];

    groups.push({
      label:
        lookupKind === "client" ? "Clientes" : lookupKind === "insurer" ? "Aseguradoras" : "Pólizas origen",
      items: [
        ...(lookupLoading
          ? [
              {
                id: "loading",
                label: "Buscando...",
                description: "Consultando toda la base.",
                searchValue: "buscando",
                disabled: true,
              },
            ]
          : []),
        ...(lookupError
          ? [
              {
                id: "error",
                label: "No se pudo buscar",
                description: lookupError,
                searchValue: lookupError,
                disabled: true,
              },
            ]
          : []),
        ...mappedItems,
      ],
    });

    if (lookupKind === "client") {
      groups.push({
        label: "Acciones",
        items: [
          {
            id: "create-client",
            label: "Crear cliente inline",
            description: "Usa los datos capturados del PDF y sigue sin salir de esta pantalla.",
            searchValue: "crear cliente inline",
            onSelect: () => {
              setShowInlineClient(true);
              resetLookupState();
            },
          },
        ],
      });
    }

    return groups;
  })();

  if (!draft) {
    return (
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="flex items-center gap-2">
              <FileUp className="size-5" />
              PDF de carátula
            </CardTitle>
            <CardDescription>
              Sube la carátula para extraer el borrador editable y luego confirma la renovación.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="pdf-file">Carátula PDF</Label>
              <Input
                id="pdf-file"
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                  setPreview(null);
                  setError(null);
                }}
                disabled={isAnalyzing || isConfirming}
              />
              {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={analyzeFile} disabled={!file || isAnalyzing || isConfirming}>
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                    Analizando...
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 size-4" />
                    Analizar PDF
                  </>
                )}
              </Button>
              <Button type="button" variant="outline" className="bg-card/70" onClick={clearAll} disabled={isAnalyzing || isConfirming}>
                Limpiar
              </Button>
            </div>

            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              El PDF no se adjunta como documento. Solo se usa para capturar, revisar y crear la póliza nueva.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <CommandPalette
        open={lookupOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetLookupState();
            return;
          }
          setLookupOpen(true);
        }}
        groups={lookupGroups}
        title={
          lookupKind === "client" ? "Buscar cliente en toda la base" : lookupKind === "insurer" ? "Buscar aseguradora en toda la base" : "Buscar póliza origen"
        }
        description="La búsqueda usa toda la base y no se limita a las primeras sugerencias."
        placeholder="Escribe para filtrar..."
        inputValue={lookupQuery}
        onInputValueChange={setLookupQuery}
        shouldFilter={false}
        className="max-w-3xl"
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="flex items-center gap-2">
              <FileUp className="size-5" />
              PDF de carátula
            </CardTitle>
            <CardDescription>
              Sube la carátula, revisa el borrador editable y confirma la renovación cuando todo esté listo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="pdf-file">Carátula PDF</Label>
              <Input
                id="pdf-file"
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                  setPreview(null);
                  setError(null);
                }}
                disabled={isAnalyzing || isConfirming}
              />
              {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={analyzeFile} disabled={!file || isAnalyzing || isConfirming}>
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                    Analizando...
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 size-4" />
                    Analizar PDF
                  </>
                )}
              </Button>
              <Button type="button" variant="outline" className="bg-card/70" onClick={clearAll} disabled={isAnalyzing || isConfirming}>
                Limpiar
              </Button>
            </div>

            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              El PDF no se adjunta como documento. Solo se usa para capturar, revisar y crear la póliza nueva.
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="border-b border-border/70">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-5" />
                Captura editable
              </CardTitle>
              <CardDescription>
                Corrige cada campo antes de confirmar. Los campos dudosos se marcan con una advertencia visual.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-5">
              {preview?.warnings.length ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {preview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {preview?.aiReview ? (
                <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                  <div>
                    <p className="font-medium">Revisión IA</p>
                    <p className="mt-1">{preview.aiReview.summary}</p>
                  </div>
                  {preview.aiReview.warnings.length > 0 ? (
                    <div>
                      <p className="font-medium">Observaciones</p>
                      {preview.aiReview.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
                    </div>
                  ) : null}
                  {preview.aiReview.suggestions.length > 0 ? (
                    <div>
                      <p className="font-medium">Sugerencias</p>
                      {preview.aiReview.suggestions.map((suggestion) => <p key={suggestion}>· {suggestion}</p>)}
                    </div>
                  ) : null}
                  {preview.aiReview.corrections.length > 0 ? (
                    <div>
                      <p className="font-medium">Correcciones propuestas para revisar</p>
                      {preview.aiReview.corrections.map((correction) => (
                        <p key={`${correction.field}-${correction.proposedValue}`}>
                          · {correction.field}: {correction.proposedValue} ({correction.confidence}) · {correction.reason}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs opacity-75">La IA no aplica cambios ni guarda la póliza. Confirma cada campo en el formulario.</p>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Nueva póliza</p>
                  <p className="mt-1 text-lg font-semibold">{draft.policyNumber || "Sin detectar"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {draft.clientName || "Sin cliente"} · {draft.insurerName || "Sin aseguradora"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">Origen: {selectedSourcePolicyLabel || draft.sourcePolicyNumber || "Sin sugerencia"}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Confianza general</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selectedSourcePolicyId ? "Póliza origen resuelta" : "Falta elegir póliza origen"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedClientLabel || draft.clientName || "Sin cliente"} · {selectedInsurerLabel || draft.insurerName || "Sin aseguradora"}
                  </p>
                </div>
              </div>

              {previewSummary ? (
                <div className="flex flex-wrap gap-2">
                  {previewSummary.map((item) => (
                    <Badge key={item} variant="secondary" className="rounded-full">
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <Section title="Póliza" description="Número, fechas, prima y condiciones base.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Número de póliza" confidence={fieldConfidence.policyNumber}>
                    <Input
                      value={draft.policyNumber}
                      onChange={(event) => {
                        updateDraft({ policyNumber: event.target.value });
                        setSelectedSourcePolicyId("");
                        setSelectedSourcePolicyLabel("");
                        markFieldConfidence("policyNumber");
                      }}
                    />
                  </Field>
                  <Field label="Tipo de póliza" confidence={fieldConfidence.policyType}>
                    <ControlledSelect
                      value={draft.policyType}
                      onValueChange={(value) => {
                        updateDraft({ policyType: value });
                        markFieldConfidence("policyType");
                      }}
                      options={policyTypeOptions}
                      placeholder="Selecciona un tipo"
                    />
                  </Field>
                  <Field label="Inicio de vigencia" confidence={fieldConfidence.startDate}>
                    <Input
                      type="date"
                      value={draft.startDate}
                      onChange={(event) => {
                        updateDraft({ startDate: event.target.value });
                        markFieldConfidence("startDate");
                      }}
                    />
                  </Field>
                  <Field label="Fin de vigencia" confidence={fieldConfidence.endDate}>
                    <Input
                      type="date"
                      value={draft.endDate}
                      onChange={(event) => {
                        updateDraft({ endDate: event.target.value });
                        markFieldConfidence("endDate");
                      }}
                    />
                  </Field>
                  <Field label="Emisión" confidence={fieldConfidence.issueDate}>
                    <Input
                      type="date"
                      value={draft.issueDate ?? ""}
                      onChange={(event) => {
                        updateDraft({ issueDate: event.target.value || null });
                        markFieldConfidence("issueDate");
                      }}
                    />
                  </Field>
                  <Field label="Frecuencia de pago" confidence={fieldConfidence.paymentFrequency}>
                    <ControlledSelect
                      value={draft.paymentFrequency}
                      onValueChange={(value) => {
                        updateDraft({ paymentFrequency: value });
                        markFieldConfidence("paymentFrequency");
                      }}
                      options={paymentFrequencyOptions}
                      placeholder="Selecciona una frecuencia"
                    />
                  </Field>
                  <Field label="Prima total" confidence={fieldConfidence.premiumAmount}>
                    <Input
                      type="number"
                      step="0.01"
                      value={Number.isFinite(draft.premiumAmount) ? String(draft.premiumAmount) : "0"}
                      onChange={(event) => {
                        updateDraft({ premiumAmount: Number(event.target.value || 0) });
                        markFieldConfidence("premiumAmount");
                      }}
                    />
                  </Field>
                  <Field label="Moneda" confidence="high">
                    <ControlledSelect
                      value={draft.currency}
                      onValueChange={(value) => {
                        updateDraft({ currency: value });
                      }}
                      options={currencyOptions}
                      placeholder="Selecciona una moneda"
                    />
                  </Field>
                  <Field label="Plan de pago" confidence="medium">
                    <Input
                      value={draft.paymentPlan ?? ""}
                      onChange={(event) => updateDraft({ paymentPlan: event.target.value || null })}
                    />
                  </Field>
                  <Field label="Solicitud" confidence="medium">
                    <Input
                      value={draft.requestNumber ?? ""}
                      onChange={(event) => updateDraft({ requestNumber: event.target.value || null })}
                    />
                  </Field>
                  <Field label="Serie" confidence={fieldConfidence.serialNumber}>
                    <Input
                      value={draft.serialNumber ?? ""}
                      onChange={(event) => {
                        updateDraft({ serialNumber: event.target.value || null });
                        markFieldConfidence("serialNumber");
                      }}
                    />
                  </Field>
                  <Field label="Póliza origen" confidence={fieldConfidence.sourcePolicyNumber}>
                    <div className="flex gap-2">
                      <Input
                        value={draft.sourcePolicyNumber ?? ""}
                        onChange={(event) => {
                          updateDraft({ sourcePolicyNumber: event.target.value || null });
                          setSelectedSourcePolicyId("");
                          setSelectedSourcePolicyLabel("");
                          markFieldConfidence("sourcePolicyNumber");
                        }}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openLookup("policy")}
                        className="shrink-0"
                      >
                        <Search className="mr-2 size-4" />
                        Buscar
                      </Button>
                    </div>
                  </Field>
                </div>
              </Section>

              <Section title="Recibos" description="Edita el monto de cada recibo antes de confirmar la captura.">
                {receiptPlan.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border bg-muted/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Total recibos</p>
                        <p className="mt-1 text-lg font-semibold">{formatCurrency(receiptPlanTotal, draft.currency)}</p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Prima total</p>
                        <p className="mt-1 text-lg font-semibold">{formatCurrency(draft.premiumAmount, draft.currency)}</p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Recibos generados</p>
                        <p className="mt-1 text-lg font-semibold">{receiptPlan.length}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {receiptPlan.map((item) => (
                        <div key={item.receiptNumber} className="rounded-xl border bg-background/80 p-4">
                          <div className="grid gap-4 lg:grid-cols-[0.6fr_1fr_1fr_0.8fr] lg:items-end">
                            <div className="space-y-1">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Recibo</p>
                              <p className="text-base font-semibold">{item.receiptNumber}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Periodo</p>
                              <p className="text-sm font-medium">
                                {formatDate(item.periodStartDate)} · {formatDate(item.periodEndDate)}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Vencimiento</p>
                              <p className="text-sm font-medium">{formatDate(item.dueDate)}</p>
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`receipt-amount-${item.receiptNumber}`} className="text-xs uppercase tracking-wide text-muted-foreground">
                                Monto
                              </Label>
                              <Input
                                id={`receipt-amount-${item.receiptNumber}`}
                                type="number"
                                step="0.01"
                                value={Number.isFinite(item.amount) ? String(item.amount) : "0"}
                                onChange={(event) => updateReceiptAmount(item.receiptNumber, event.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Completa las fechas y la frecuencia de pago para generar los recibos.
                  </div>
                )}
              </Section>

              <Section title="Cliente" description="Puedes corregirlo aquí o abrir la búsqueda global para elegir un registro existente.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Nombre del cliente" confidence={fieldConfidence.clientName}>
                    <div className="flex gap-2">
                      <Input
                        value={draft.clientName}
                        onChange={(event) => {
                          updateDraft({
                            clientName: event.target.value,
                            clientType: inferClientType(event.target.value, draft.clientRfc),
                          });
                          setSelectedClientId("");
                          setSelectedClientLabel("");
                          setSelectedSourcePolicyId("");
                          setSelectedSourcePolicyLabel("");
                          setShowInlineClient(true);
                          markFieldConfidence("clientName");
                          markFieldConfidence("clientType");
                        }}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" onClick={() => openLookup("client")} className="shrink-0">
                        <Search className="mr-2 size-4" />
                        Buscar
                      </Button>
                    </div>
                  </Field>

                  <Field label="Tipo de cliente" confidence={fieldConfidence.clientType}>
                    <ControlledSelect
                      value={draft.clientType}
                      onValueChange={(value) =>
                        {
                          updateDraft({ clientType: value as PolicyPdfCaptureDraft["clientType"] });
                          markFieldConfidence("clientType");
                        }
                      }
                      options={clientTypeOptions}
                      placeholder="Selecciona un tipo"
                    />
                  </Field>

                  <Field label="RFC" confidence={fieldConfidence.clientRfc}>
                    <Input
                      value={draft.clientRfc ?? ""}
                      onChange={(event) => {
                        updateDraft({
                          clientRfc: event.target.value || null,
                          clientType: inferClientType(draft.clientName, event.target.value || null),
                        });
                        setSelectedClientId("");
                        setSelectedClientLabel("");
                        setSelectedSourcePolicyId("");
                        setSelectedSourcePolicyLabel("");
                        markFieldConfidence("clientRfc");
                        markFieldConfidence("clientType");
                      }}
                    />
                  </Field>

                  <Field label="Fecha de nacimiento" confidence={fieldConfidence.clientBirthDate}>
                    <Input
                      type="date"
                      value={draft.clientBirthDate ?? ""}
                      onChange={(event) => {
                        updateDraft({ clientBirthDate: event.target.value || null });
                        markFieldConfidence("clientBirthDate");
                      }}
                    />
                  </Field>

                  <Field label="Teléfono" confidence={fieldConfidence.clientPhone}>
                    <Input
                      value={draft.clientPhone ?? ""}
                      onChange={(event) => {
                        updateDraft({ clientPhone: event.target.value || null });
                        setSelectedClientId("");
                        setSelectedClientLabel("");
                        setSelectedSourcePolicyId("");
                        setSelectedSourcePolicyLabel("");
                        markFieldConfidence("clientPhone");
                      }}
                    />
                  </Field>

                  <Field label="Email" confidence={fieldConfidence.clientEmail}>
                    <Input
                      type="email"
                      value={draft.clientEmail ?? ""}
                      onChange={(event) => {
                        updateDraft({ clientEmail: event.target.value || null });
                        setSelectedClientId("");
                        setSelectedClientLabel("");
                        setSelectedSourcePolicyId("");
                        setSelectedSourcePolicyLabel("");
                        markFieldConfidence("clientEmail");
                      }}
                    />
                  </Field>

                  <Field label="Dirección" confidence={fieldConfidence.clientAddress}>
                    <Textarea
                      rows={3}
                      value={draft.clientAddress ?? ""}
                      onChange={(event) => {
                        updateDraft({ clientAddress: event.target.value || null });
                        setSelectedClientId("");
                        setSelectedClientLabel("");
                        setSelectedSourcePolicyId("");
                        setSelectedSourcePolicyLabel("");
                        markFieldConfidence("clientAddress");
                      }}
                      className="max-h-32 overflow-y-auto"
                    />
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-full">
                    {selectedClientLabel || draft.clientName || "Sin cliente resuelto"}
                  </Badge>
                  {selectedClientId ? (
                    <Badge variant="outline" className="rounded-full">
                      Cliente existente seleccionado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                      Cliente nuevo o sin vínculo
                    </Badge>
                  )}
                  <Button type="button" variant="outline" onClick={() => setShowInlineClient((current) => !current)}>
                    <Sparkles className="mr-2 size-4" />
                    {showInlineClient ? "Ocultar alta inline" : "Alta inline de cliente"}
                  </Button>
                  {!selectedClientId ? (
                    <Button type="button" variant="secondary" onClick={createInlineClient} disabled={isCreatingClient}>
                      {isCreatingClient ? "Creando cliente..." : "Guardar cliente y seguir"}
                    </Button>
                  ) : null}
                </div>

                {showInlineClient ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-4">
                    <p className="text-sm font-medium">Alta inline mínima</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Usa los campos capturados para crear el cliente sin salir de la captura. Si ya existe, el sistema lo reutiliza.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border bg-background/80 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Nombre</p>
                        <p className="mt-1 text-sm font-medium">{draft.clientName || "Sin nombre"}</p>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">RFC</p>
                        <p className="mt-1 text-sm font-medium">{draft.clientRfc || "Sin RFC"}</p>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Teléfono</p>
                        <p className="mt-1 text-sm font-medium">{draft.clientPhone || "Sin teléfono"}</p>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                        <p className="mt-1 text-sm font-medium">{draft.clientEmail || "Sin email"}</p>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-3 sm:col-span-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Dirección</p>
                        <p className="mt-1 text-sm font-medium">{draft.clientAddress || "Sin dirección"}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </Section>

              <Section title="Contenido" description="Datos complementarios que también se copiarán a la póliza nueva.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Objeto asegurado" confidence="medium">
                    <Textarea
                      rows={3}
                      value={draft.insuredObject ?? ""}
                      onChange={(event) => updateDraft({ insuredObject: event.target.value || null })}
                      className="max-h-32 overflow-y-auto"
                    />
                  </Field>
                  <Field label="Beneficiarios" confidence="medium">
                    <Textarea
                      rows={3}
                      value={draft.beneficiaryInfo ?? ""}
                      onChange={(event) => updateDraft({ beneficiaryInfo: event.target.value || null })}
                      className="max-h-28 overflow-y-auto"
                    />
                  </Field>
                  <Field label="Notas" confidence="medium">
                    <Textarea
                      rows={4}
                      value={draft.notes ?? ""}
                      onChange={(event) => updateDraft({ notes: event.target.value || null })}
                      className="max-h-28 overflow-y-auto"
                    />
                  </Field>
                </div>
              </Section>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="border-b border-border/70">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5" />
                Confirmación de renovación
              </CardTitle>
              <CardDescription>
                Revisa la póliza origen, confirma las entidades y guarda la nueva vigencia sin perder el borrador.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</p>
                  <p className="mt-1 text-sm font-semibold">{selectedClientLabel || draft.clientName || "Sin seleccionar"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedClientId || "No resuelto todavía"}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Aseguradora</p>
                  <p className="mt-1 text-sm font-semibold">{selectedInsurerLabel || draft.insurerName || "Sin seleccionar"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedInsurerId || "No resuelta todavía"}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Póliza origen</p>
                  <p className="mt-1 text-sm font-semibold">{selectedSourcePolicyLabel || draft.sourcePolicyNumber || "Sin sugerencia exacta"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedSourcePolicyId ? "Seleccionada manualmente o por match exacto." : "Debes buscar y elegir una póliza válida antes de confirmar."}
                  </p>
                  <div className="mt-3">
                    <Button type="button" variant="outline" onClick={() => openLookup("policy")}>
                      <Search className="mr-2 size-4" />
                      Buscar póliza origen
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vigencia" confidence="high">
                  <div className="rounded-xl border bg-muted/30 p-4 text-sm font-medium">
                    {draft.startDate && draft.endDate ? `${formatDate(draft.startDate)} · ${formatDate(draft.endDate)}` : "Sin capturar"}
                  </div>
                </Field>
                <Field label="Prima" confidence={fieldConfidence.premiumAmount}>
                  <div className="rounded-xl border bg-muted/30 p-4 text-sm font-medium">
                    {formatCurrency(draft.premiumAmount, draft.currency)}
                  </div>
                </Field>
                <Field label="Frecuencia" confidence={fieldConfidence.paymentFrequency}>
                  <div className="rounded-xl border bg-muted/30 p-4 text-sm font-medium">
                    {normalizePdfPaymentFrequencyLabel(draft.paymentFrequency)}
                  </div>
                </Field>
                <Field label="Serie" confidence={fieldConfidence.serialNumber}>
                  <div className="rounded-xl border bg-muted/30 p-4 text-sm font-medium">
                    {draft.serialNumber || "Sin capturar"}
                  </div>
                </Field>
              </div>

              <Button
                type="button"
                className="w-full"
                onClick={confirmCapture}
                disabled={isConfirming || !selectedClientId || !selectedInsurerId || !selectedSourcePolicyId}
              >
                {isConfirming ? "Confirmando..." : "Crear póliza y marcar como renovada"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence: "high" | "medium" | "low";
  children: React.ReactNode;
}) {
  const warn = confidence !== "high";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className={warn ? "text-amber-700 dark:text-amber-200" : ""}>{label}</Label>
        {fieldConfidenceBadge(confidence)}
      </div>
      {children}
    </div>
  );
}
