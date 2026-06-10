"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Link2,
  Loader2,
  PencilLine,
  Search,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeRiskIssuesAction, denyRenewalSuggestionReview, linkRenewalSuggestionToPolicy } from "@/app/(dashboard)/data-quality/actions";
import { consolidateClientIntoTarget, updateClientQualityFields } from "@/app/(dashboard)/clients/actions";
import { updatePolicyQualityFields } from "@/app/(dashboard)/policies/actions";
import { linkRenewalToPolicy, markRenewalAsNotContinuing } from "@/app/(dashboard)/renewals/actions";
import type { GlobalSearchResult } from "@/lib/search";
import type { MutationResult } from "@/lib/mutation-utils";
import { cn } from "@/lib/utils";
import { paymentFrequencyOptions, policyStatusOptions } from "@/lib/domain-options";

type SearchKind = "client" | "policy";

type SearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  sourceLabel: string;
  searchKind: SearchKind;
  initialQuery: string;
  suggestions: string[];
  onPick: (result: GlobalSearchResult) => Promise<MutationResult>;
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function SearchDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  sourceLabel,
  searchKind,
  initialQuery,
  suggestions,
  onPick,
}: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setError(null);
      setResults([]);
    }
  }, [initialQuery, open]);

  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error("No se pudo buscar ahora mismo.");
        }

        const data = (await response.json()) as GlobalSearchResult[];
        const filtered = data.filter((result) => result.type === searchKind);
        setResults(filtered.slice(0, 8));
      } catch (fetchError) {
        if ((fetchError as Error).name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "No se pudo buscar ahora mismo.");
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, searchKind]);

  async function selectResult(result: GlobalSearchResult) {
    try {
      setIsSubmitting(true);
      const mutation = await onPick(result);
      if (!mutation.ok) {
        toast.error(mutation.error);
        return;
      }
      toast.success(mutation.message);
      onOpenChange(false);
      router.refresh();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "No se pudo completar la acción.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const suggestionButtons = uniqueStrings(suggestions);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
            <span className="block text-xs text-muted-foreground">Origen: {sourceLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="h-10 pl-9"
              autoComplete="off"
            />
          </div>

          {suggestionButtons.length ? (
            <div className="flex flex-wrap gap-2">
              {suggestionButtons.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setQuery(suggestion)}
                  disabled={isSubmitting}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="max-h-[360px] overflow-auto rounded-2xl border border-border/70 bg-muted/20">
            {error ? (
              <div className="px-4 py-6 text-sm text-destructive">{error}</div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Buscando sugerencias...
              </div>
            ) : query.trim().length < 2 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Empieza a escribir para ver coincidencias por nombre, póliza, aseguradora o cliente.
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">No encontramos coincidencias para esta búsqueda.</div>
            ) : (
              <div className="divide-y divide-border/70">
                {results.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/70",
                      isSubmitting ? "pointer-events-none opacity-60" : "",
                    )}
                    onClick={() => void selectResult(result)}
                    disabled={isSubmitting}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-foreground">{result.title}</span>
                        <Badge variant="outline" className="rounded-full text-[11px] uppercase tracking-wide">
                          {result.type}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.subtitle ?? "Sin descripción"}</p>
                      {result.match ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Coincidencia: {result.match.fieldLabel} · {result.match.snippet}
                        </p>
                      ) : null}
                    </div>
                    <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="rounded-full" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ClientEditableFields = {
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  address: string | null;
  rfc: string | null;
  preferredContactMethod: string | null;
  notes: string | null;
};

type PolicyEditableFields = {
  insuredObject: string | null;
  premiumAmount: number;
  paymentFrequency: string;
  status: string;
  notes: string | null;
};

type ClientResolutionActionsProps = ClientEditableFields & {
  clientId: string;
  clientName: string;
  issueCodes: string[];
  allowClose?: boolean;
  allowEdit?: boolean;
  className?: string;
  closeLabel?: string;
  editLabel?: string;
  consolidateLabel?: string;
};

type PolicyResolutionActionsProps = PolicyEditableFields & {
  policyId: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  issueCodes: string[];
  allowClose?: boolean;
  allowEdit?: boolean;
  className?: string;
  closeLabel?: string;
  editLabel?: string;
};

type RenewalResolutionActionsProps = {
  sourcePolicyId: string;
  sourcePolicyNumber: string;
  clientName: string;
  insurerName: string;
  mode: "policy" | "suggestion";
  suggestionId?: string;
  className?: string;
};

function useMutationState() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function runMutation(action: () => Promise<MutationResult>) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
      }
    });
  }

  return { isPending, runMutation, router };
}

export function RenewalResolutionActions({
  sourcePolicyId,
  sourcePolicyNumber,
  clientName,
  insurerName,
  mode,
  suggestionId,
  className,
}: RenewalResolutionActionsProps) {
  const { isPending, runMutation } = useMutationState();
  const [searchOpen, setSearchOpen] = useState(false);
  const sourceLabel = `${sourcePolicyNumber} · ${clientName} · ${insurerName}`;
  const suggestions = useMemo(
    () => uniqueStrings([sourcePolicyNumber, clientName, insurerName, `${clientName} ${insurerName}`, `${sourcePolicyNumber} ${insurerName}`]),
    [clientName, insurerName, sourcePolicyNumber],
  );

  const closeAction =
    mode === "suggestion"
      ? () => {
          if (!suggestionId) {
            return Promise.resolve({ ok: false, error: "Falta la sugerencia origen." } as MutationResult);
          }
          return denyRenewalSuggestionReview(suggestionId);
        }
      : () => markRenewalAsNotContinuing(sourcePolicyId);

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="rounded-full" disabled={isPending} />}>
          <Wrench className="size-4" />
          Resolver
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => runMutation(closeAction)}>
            <BadgeCheck className="mr-2 size-4" />
            No renovada
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSearchOpen(true)}>
            <Search className="mr-2 size-4" />
            Vincular renovación
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Vincular renovación"
        description="Busca la póliza destino por cliente, serie, aseguradora o número de póliza."
        placeholder="Cliente, póliza, aseguradora..."
        sourceLabel={sourceLabel}
        searchKind="policy"
        initialQuery={`${clientName} ${insurerName}`}
        suggestions={suggestions}
        onPick={async (result) => {
          if (mode === "suggestion") {
            if (!suggestionId) {
              return { ok: false, error: "Falta la sugerencia de renovación." };
            }
            return linkRenewalSuggestionToPolicy(suggestionId, result.id);
          }
          return linkRenewalToPolicy(sourcePolicyId, result.id);
        }}
      />
    </div>
  );
}

export function ClientResolutionActions({
  clientId,
  clientName,
  email,
  phone,
  secondaryPhone,
  address,
  rfc,
  preferredContactMethod,
  notes,
  issueCodes,
  allowClose = true,
  allowEdit = true,
  className,
  closeLabel = "OK",
  editLabel = "Editar y cerrar",
  consolidateLabel = "Consolidar",
}: ClientResolutionActionsProps) {
  const { runMutation, router } = useMutationState();
  const [editOpen, setEditOpen] = useState(false);
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const [emailValue, setEmailValue] = useState(email ?? "");
  const [phoneValue, setPhoneValue] = useState(phone ?? "");
  const [secondaryPhoneValue, setSecondaryPhoneValue] = useState(secondaryPhone ?? "");
  const [addressValue, setAddressValue] = useState(address ?? "");
  const [rfcValue, setRfcValue] = useState(rfc ?? "");
  const [preferredContactMethodValue, setPreferredContactMethodValue] = useState(preferredContactMethod ?? "");
  const [notesValue, setNotesValue] = useState(notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const consolidateOnly = issueCodes.length > 0 && issueCodes.every((code) => code === "CLIENT_WITHOUT_POLICY");
  const issueSummary = uniqueStrings(issueCodes);
  const suggestions = useMemo(() => uniqueStrings([clientName, ...clientName.split(" ").filter((piece) => piece.length >= 3)]), [clientName]);

  useEffect(() => {
    if (!editOpen) return;
    setEmailValue(email ?? "");
    setPhoneValue(phone ?? "");
    setSecondaryPhoneValue(secondaryPhone ?? "");
    setAddressValue(address ?? "");
    setRfcValue(rfc ?? "");
    setPreferredContactMethodValue(preferredContactMethod ?? "");
    setNotesValue(notes ?? "");
  }, [address, email, editOpen, notes, phone, preferredContactMethod, rfc, secondaryPhone]);

  async function saveClientAndClose() {
    try {
      setIsSaving(true);
      const update = await updateClientQualityFields(clientId, {
        email: emailValue,
        phone: phoneValue,
        secondaryPhone: secondaryPhoneValue,
        address: addressValue,
        rfc: rfcValue,
        preferredContactMethod: preferredContactMethodValue,
        notes: notesValue,
      });

      if (!update.ok) {
        toast.error(update.error);
        return;
      }

      if (allowClose && issueCodes.length > 0) {
        const close = await closeRiskIssuesAction({
          entityType: "Client",
          entityId: clientId,
          issueCodes,
        });
        if (!close.ok) {
          toast.error(close.error);
          return;
        }
        toast.success("Datos guardados y caso cerrado.");
      } else {
        toast.success(update.message);
      }

      setEditOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cliente.");
    } finally {
      setIsSaving(false);
    }
  }

  async function closeClientCase() {
    runMutation(() => closeRiskIssuesAction({
      entityType: "Client",
      entityId: clientId,
      issueCodes,
    }));
  }

  async function consolidateClient(targetId: string) {
    if (targetId === clientId) {
      toast.error("El cliente destino debe ser distinto al origen.");
      return { ok: false, error: "El cliente destino debe ser distinto al origen." } as MutationResult;
    }
    return consolidateClientIntoTarget(clientId, targetId, "Consolidado manualmente desde Riesgos y calidad.");
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="rounded-full" />}>
          <PencilLine className="size-4" />
          Resolver
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {allowEdit ? (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <PencilLine className="mr-2 size-4" />
              {editLabel}
            </DropdownMenuItem>
          ) : null}
          {allowClose && !consolidateOnly ? (
            <DropdownMenuItem onSelect={() => void closeClientCase()}>
              <BadgeCheck className="mr-2 size-4" />
              {closeLabel}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setConsolidateOpen(true)}>
            <Users className="mr-2 size-4" />
            {consolidateLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>{clientName}</DialogTitle>
            <DialogDescription>
              Completa los datos que faltan y cierra el caso sin salir de la tabla.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`client-email-${clientId}`}>Email</Label>
              <Input id={`client-email-${clientId}`} value={emailValue} onChange={(event) => setEmailValue(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`client-phone-${clientId}`}>Teléfono</Label>
              <Input id={`client-phone-${clientId}`} value={phoneValue} onChange={(event) => setPhoneValue(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`client-secondary-phone-${clientId}`}>Teléfono secundario</Label>
              <Input id={`client-secondary-phone-${clientId}`} value={secondaryPhoneValue} onChange={(event) => setSecondaryPhoneValue(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`client-rfc-${clientId}`}>RFC</Label>
              <Input id={`client-rfc-${clientId}`} value={rfcValue} onChange={(event) => setRfcValue(event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`client-address-${clientId}`}>Dirección</Label>
              <Textarea id={`client-address-${clientId}`} value={addressValue} onChange={(event) => setAddressValue(event.target.value)} rows={3} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`client-contact-method-${clientId}`}>Método de contacto preferido</Label>
              <Input
                id={`client-contact-method-${clientId}`}
                value={preferredContactMethodValue}
                onChange={(event) => setPreferredContactMethodValue(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`client-notes-${clientId}`}>Notas</Label>
              <Textarea id={`client-notes-${clientId}`} value={notesValue} onChange={(event) => setNotesValue(event.target.value)} rows={3} />
            </div>
          </div>

          {issueSummary.length ? (
            <div className="flex flex-wrap gap-2">
              {issueSummary.map((issue) => (
                <Badge key={issue} variant="outline" className="rounded-full">
                  {issue}
                </Badge>
              ))}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setEditOpen(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void closeClientCase()} disabled={isSaving || !allowClose}>
              {closeLabel}
            </Button>
            <Button type="button" className="rounded-full" onClick={() => void saveClientAndClose()} disabled={isSaving}>
              {isSaving ? "Guardando..." : "Guardar y cerrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SearchDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        title="Consolidar cliente"
        description="Busca el cliente canónico al que quieres mover la información."
        placeholder="Cliente similar..."
        sourceLabel={clientName}
        searchKind="client"
        initialQuery={clientName}
        suggestions={suggestions}
        onPick={(result) => consolidateClient(result.id)}
      />
    </div>
  );
}

export function PolicyResolutionActions({
  policyId,
  policyNumber,
  clientName,
  insurerName,
  insuredObject,
  premiumAmount,
  paymentFrequency,
  status,
  notes,
  issueCodes,
  allowClose = true,
  allowEdit = true,
  className,
  closeLabel = "OK",
  editLabel = "Editar y cerrar",
}: PolicyResolutionActionsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [insuredObjectValue, setInsuredObjectValue] = useState(insuredObject ?? "");
  const [premiumAmountValue, setPremiumAmountValue] = useState(String(premiumAmount || ""));
  const [paymentFrequencyValue, setPaymentFrequencyValue] = useState(paymentFrequency);
  const [statusValue, setStatusValue] = useState(status);
  const [notesValue, setNotesValue] = useState(notes ?? "");
  const issueSummary = uniqueStrings(issueCodes);
  const { runMutation, router } = useMutationState();

  useEffect(() => {
    if (!editOpen) return;
    setInsuredObjectValue(insuredObject ?? "");
    setPremiumAmountValue(String(premiumAmount || ""));
    setPaymentFrequencyValue(paymentFrequency);
    setStatusValue(status);
    setNotesValue(notes ?? "");
  }, [editOpen, insuredObject, notes, paymentFrequency, premiumAmount, status]);

  async function savePolicyAndClose() {
    try {
      setIsSaving(true);
      const update = await updatePolicyQualityFields(policyId, {
        insuredObject: insuredObjectValue,
        premiumAmount: premiumAmountValue,
        paymentFrequency: paymentFrequencyValue,
        status: statusValue,
        notes: notesValue,
      });

      if (!update.ok) {
        toast.error(update.error);
        return;
      }

      if (allowClose && issueCodes.length > 0) {
        const close = await closeRiskIssuesAction({
          entityType: "Policy",
          entityId: policyId,
          issueCodes,
        });
        if (!close.ok) {
          toast.error(close.error);
          return;
        }
        toast.success("Datos guardados y caso cerrado.");
      } else {
        toast.success(update.message);
      }

      setEditOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la póliza.");
    } finally {
      setIsSaving(false);
    }
  }

  async function closePolicyCase() {
    runMutation(() => closeRiskIssuesAction({
      entityType: "Policy",
      entityId: policyId,
      issueCodes,
    }));
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="rounded-full" />}>
          <PencilLine className="size-4" />
          Resolver
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {allowEdit ? (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <PencilLine className="mr-2 size-4" />
              {editLabel}
            </DropdownMenuItem>
          ) : null}
          {allowClose ? (
            <DropdownMenuItem onSelect={() => void closePolicyCase()}>
              <BadgeCheck className="mr-2 size-4" />
              {closeLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>{policyNumber}</DialogTitle>
            <DialogDescription>
              Revisa los datos visibles y cierra el hallazgo sin salir de la tabla.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`policy-insured-object-${policyId}`}>Objeto asegurado</Label>
              <Input id={`policy-insured-object-${policyId}`} value={insuredObjectValue} onChange={(event) => setInsuredObjectValue(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`policy-premium-${policyId}`}>Prima</Label>
              <Input
                id={`policy-premium-${policyId}`}
                type="number"
                min="0"
                step="0.01"
                value={premiumAmountValue}
                onChange={(event) => setPremiumAmountValue(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`policy-payment-frequency-${policyId}`}>Frecuencia de pago</Label>
              <select
                id={`policy-payment-frequency-${policyId}`}
                value={paymentFrequencyValue}
                onChange={(event) => setPaymentFrequencyValue(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {paymentFrequencyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`policy-status-${policyId}`}>Estado</Label>
              <select
                id={`policy-status-${policyId}`}
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {policyStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`policy-notes-${policyId}`}>Notas</Label>
              <Textarea id={`policy-notes-${policyId}`} value={notesValue} onChange={(event) => setNotesValue(event.target.value)} rows={3} />
            </div>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div>Póliza: {policyNumber}</div>
            <div>Cliente: {clientName}</div>
            <div>Aseguradora: {insurerName}</div>
            <div>Hallazgos: {issueSummary.length ? issueSummary.join(" · ") : "Sin hallazgos"}</div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setEditOpen(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void closePolicyCase()} disabled={isSaving || !allowClose}>
              {closeLabel}
            </Button>
            <Button type="button" className="rounded-full" onClick={() => void savePolicyAndClose()} disabled={isSaving}>
              {isSaving ? "Guardando..." : "Guardar y cerrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
