"use client";

import Link from "next/link";
import { useState } from "react";
import { CarFront, ChevronDown, CircleDollarSign, FileText, MapPin, Users } from "lucide-react";
import type { ReactNode } from "react";
import { getPolicyRiskDetailEntries, policyRiskDetailsSchema, type PolicyRiskDetails } from "@/lib/policy-risk-details";

type InsuredAsset = {
  id: string;
  assetType: string;
  unitClass: string | null;
  description: string;
  serialNumber: string | null;
};

type InsuredParty = {
  id: string;
  fullName: string;
  isPrimary: boolean;
};

type Vehicle = Extract<PolicyRiskDetails, { policyType: "AUTO" }>["data"]["vehicles"][number];
type Location = Extract<PolicyRiskDetails, { policyType: "DANOS" }>["data"]["locations"][number];
type InsuredPerson = Extract<PolicyRiskDetails, { policyType: "GMM" }>["data"]["insuredPeople"][number];

type PolicyRiskOverviewProps = {
  policyType: string;
  clientId: string;
  clientName: string;
  insurerName: string;
  insuredObject: string | null;
  riskDetails: unknown;
  riskDetailsReviewRequired: boolean;
  insuredAssets: InsuredAsset[];
  insuredParties: InsuredParty[];
  notes: string | null;
  paymentPlan: string | null;
  paymentFrequency: string;
  paymentFrequencyLabel: string;
  beneficiaryInfo: string | null;
  commissionRateOverride: number | null;
};

function Field({ label, value, compact = false }: { label: string; value: string | null | undefined; compact?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/35 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words text-foreground ${compact ? "text-sm" : "text-sm font-medium"}`}>{value?.trim() || "Pendiente de capturar"}</p>
    </div>
  );
}

function VehicleTitle({ vehicle }: { vehicle: Vehicle }) {
  const title = [vehicle.make, vehicle.model, vehicle.year, vehicle.version].filter(Boolean).join(" ");
  return <>{title || "Vehículo sin descripción"}</>;
}

function VehicleCard({ vehicle, index, unitClass }: { vehicle: Vehicle; index: number; unitClass?: string | null }) {
  return (
    <li className="min-w-0 rounded-xl border border-border/70 bg-background p-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CarFront aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5 text-foreground"><span className="sr-only">Vehículo {index + 1}: </span><VehicleTitle vehicle={vehicle} /></p>
          {unitClass ? <p className="mt-1 text-xs text-muted-foreground">Tipo de unidad · <span className="font-medium text-foreground">{unitClass}</span></p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {vehicle.plates ? <span className="max-w-full rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Placas <span className="font-medium text-foreground">{vehicle.plates}</span></span> : null}
            {vehicle.vin ? <span className="max-w-full break-all rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Serie <span className="font-medium text-foreground">{vehicle.vin}</span></span> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function LocationCard({ location, index }: { location: Location; index: number }) {
  return (
    <li className="min-w-0 rounded-xl border border-border/70 bg-background p-3 sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MapPin aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ubicación {index + 1}</p>
          <p className="mt-1 break-words text-sm font-semibold leading-5 text-foreground">{location.address || "Dirección pendiente de capturar"}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {location.use ? <Field label="Uso" value={location.use} compact /> : null}
            {location.activity ? <Field label="Actividad" value={location.activity} compact /> : null}
            {location.construction ? <Field label="Construcción" value={location.construction} compact /> : null}
            {location.insuredValue ? <Field label="Valor asegurado" value={location.insuredValue} compact /> : null}
            {location.unitClass ? <Field label="Clase de riesgo" value={location.unitClass} compact /> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function PersonCard({ person, index, fallbackPrimary }: { person: InsuredPerson; index: number; fallbackPrimary?: boolean }) {
  const relationship = person.relationship || (fallbackPrimary ? "Titular" : "Asegurado dependiente");
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-xl border border-border/70 bg-background p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Users aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold leading-5 text-foreground"><span className="sr-only">Persona asegurada {index + 1}: </span>{person.fullName || "Persona sin nombre"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{relationship}</p>
        {person.birthDate ? <p className="mt-1 text-xs text-muted-foreground">Nacimiento · {person.birthDate}</p> : null}
      </div>
    </li>
  );
}

function RemainingRows({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  if (count <= 0) return null;
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-sm font-medium text-primary marker:content-none [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function splitCoverageText(value: string): string[] {
  return value.split(/[;\n•]+/).map((item) => item.trim()).filter(Boolean);
}

function CoverageList({ text }: { text: string }) {
  const items = splitCoverageText(text);
  if (!items.length) return null;
  const previewCount = items.length > 4 ? 3 : items.length;
  const preview = items.slice(0, previewCount);
  const remaining = items.slice(previewCount);
  const singleLongItem = items.length === 1 && items[0]!.length > 260;

  return (
    <section aria-labelledby="policy-coverages-heading" className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText aria-hidden className="size-4" /></span>
        <div>
          <h3 id="policy-coverages-heading" className="text-sm font-semibold text-foreground">Coberturas registradas</h3>
          <p className="text-xs text-muted-foreground">Texto capturado de la póliza</p>
        </div>
      </div>
      {singleLongItem ? (
        <details className="group mt-3">
          <summary className="min-h-11 cursor-pointer list-none rounded-lg border border-border/70 px-3 py-2.5 text-sm leading-5 text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="line-clamp-3 break-words">{items[0]}</span>
            <span className="mt-2 block text-xs font-medium text-primary group-open:hidden">Ver texto completo</span>
            <span className="mt-2 hidden text-xs font-medium text-primary group-open:block">Cerrar texto completo</span>
          </summary>
          <p className="mt-2 break-words rounded-lg bg-muted/35 p-3 text-sm leading-6 text-foreground">{items[0]}</p>
        </details>
      ) : (
        <ul className="mt-3 divide-y divide-border/70 rounded-lg border border-border/70 bg-background">
          {preview.map((item, index) => <li key={`${index}-${item}`} className="break-words px-3 py-2.5 text-sm leading-5 text-foreground">{item}</li>)}
          {remaining.length ? (
            <li className="p-2">
              <RemainingRows label={`Ver todas las coberturas (${items.length})`} count={remaining.length}>
                <ul className="divide-y divide-border/70 rounded-lg border border-border/70 bg-background">
                  {remaining.map((item, index) => <li key={`${index + previewCount}-${item}`} className="break-words px-3 py-2.5 text-sm leading-5 text-foreground">{item}</li>)}
                </ul>
              </RemainingRows>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function HistoricalDescription({ value }: { value: string | null }) {
  const text = value?.trim();
  if (!text) return <p className="text-sm text-muted-foreground">Pendiente de capturar</p>;
  if (text.length <= 220) return <p className="break-words text-sm leading-6 text-foreground">{text}</p>;
  return (
    <details className="group rounded-xl border border-dashed border-border p-3">
      <summary className="min-h-11 cursor-pointer list-none text-sm leading-5 text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="line-clamp-3 break-words">{text}</span>
        <span className="mt-2 block text-xs font-medium text-primary group-open:hidden">Ver descripción original completa</span>
        <span className="mt-2 hidden text-xs font-medium text-primary group-open:block">Cerrar descripción</span>
      </summary>
      <p className="mt-3 whitespace-pre-wrap break-words border-t border-border/70 pt-3 text-sm leading-6 text-foreground">{text}</p>
    </details>
  );
}

export function PolicyRiskOverview({
  policyType,
  clientId,
  clientName,
  insurerName,
  insuredObject,
  riskDetails,
  riskDetailsReviewRequired,
  insuredAssets,
  insuredParties,
  notes,
  paymentPlan,
  paymentFrequency,
  paymentFrequencyLabel,
  beneficiaryInfo,
  commissionRateOverride,
}: PolicyRiskOverviewProps) {
  const [showAllVehicles, setShowAllVehicles] = useState(false);
  const parsed = policyRiskDetailsSchema.safeParse(riskDetails);
  const riskDetailEntries = getPolicyRiskDetailEntries(riskDetails);
  const details = parsed.success && parsed.data.policyType === policyType ? parsed.data : null;
  const autoData = details?.policyType === "AUTO" ? details.data : null;
  const danosData = details?.policyType === "DANOS" ? details.data : null;
  const gmmData = details?.policyType === "GMM" ? details.data : null;

  const vehicles = (autoData?.vehicles ?? []).filter((vehicle) => Object.values(vehicle).some((value) => typeof value === "string" && value.trim()));
  const vehicleRows = vehicles.length ? vehicles.map((vehicle) => ({ vehicle, unitClass: vehicle.unitClass })) : insuredAssets.filter((asset) => asset.assetType === "AUTO").map((asset) => ({
    vehicle: { make: "", model: asset.description, year: "", version: "", plates: "", vin: asset.serialNumber ?? "", unitClass: asset.unitClass ?? "" },
    unitClass: asset.unitClass,
  }));
  const locations = (danosData?.locations ?? []).filter((location) => Object.values(location).some((value) => typeof value === "string" && value.trim()));
  const locationRows = locations.length ? locations : insuredAssets.filter((asset) => asset.assetType === "DANOS").map((asset) => ({ address: asset.description, use: "", construction: "", activity: "", insuredValue: "", unitClass: asset.unitClass ?? "" }));
  const structuredPeople = (gmmData?.insuredPeople ?? []).filter((person) => Object.values(person).some((value) => typeof value === "string" && value.trim()));
  const personRows = structuredPeople.length ? structuredPeople.map((person) => ({ person, isPrimary: false })) : insuredParties.map((party) => ({
    person: { fullName: party.fullName, birthDate: "", relationship: "", unitClass: "" },
    isPrimary: party.isPrimary,
  }));
  const fallbackAssets = insuredAssets.filter((asset) => asset.assetType === policyType);
  const displayedRiskType = policyType === "DANOS" ? "Daños" : policyType === "GMM" ? "Gastos médicos" : policyType === "AUTO" ? (vehicleRows.length > 1 ? "Flotilla" : "Vehículo asegurado") : "Riesgo asegurado";
  const coverageText = danosData?.coverageLimit?.trim() || null;
  const historicalDescription = insuredObject?.trim() || "";
  const hasStructuredRiskRows = vehicleRows.length > 0 || locationRows.length > 0 || personRows.length > 0;
  const showOriginalDescription = Boolean(historicalDescription) && (riskDetailsReviewRequired || historicalDescription.length > 220) && hasStructuredRiskRows;

  return (
    <section aria-labelledby="insured-risk-heading" className="space-y-3">
      <div>
        <h2 id="insured-risk-heading" className="text-lg font-semibold text-foreground">Riesgo asegurado</h2>
        <p className="mt-1 text-sm text-muted-foreground">{policyType === "GMM" ? "Personas aseguradas y condiciones principales del plan." : policyType === "DANOS" ? "Ubicación, actividad y coberturas registradas." : policyType === "AUTO" ? "Vehículos asegurados y datos de identificación." : "Objeto, personas y características principales del riesgo."}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{policyType === "GMM" ? "Personas aseguradas" : policyType === "DANOS" ? "Bienes asegurados" : policyType === "AUTO" ? (vehicleRows.length > 1 ? "Flotilla" : "Vehículo asegurado") : "Objeto asegurado"}</p>
            {policyType !== "AUTO" && policyType !== "DANOS" && policyType !== "GMM" ? <div className="mt-2"><HistoricalDescription value={insuredObject || fallbackAssets[0]?.description || insuredParties[0]?.fullName || null} /></div> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              <Link href={`/clients/${clientId}`} className="text-primary underline underline-offset-2 hover:decoration-2">{clientName}</Link>
              {` · ${insurerName}`}{policyType === "AUTO" ? "" : ` · ${displayedRiskType}`}
            </p>
          </div>
          {policyType === "AUTO" && vehicleRows.length ? <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{vehicleRows.length} {vehicleRows.length === 1 ? "vehículo" : "vehículos"}</span> : null}
          {policyType === "DANOS" && locationRows.length ? <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{locationRows.length} {locationRows.length === 1 ? "ubicación" : "ubicaciones"}</span> : null}
          {policyType === "GMM" && personRows.length ? <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{personRows.length} {personRows.length === 1 ? "persona" : "personas"}</span> : null}
        </div>

        {policyType === "AUTO" ? (
          vehicleRows.length ? (
            <div className="space-y-3">
              <ul className="grid gap-2 sm:grid-cols-2">
                {(showAllVehicles ? vehicleRows : vehicleRows.slice(0, 3)).map(({ vehicle, unitClass }, index) => <VehicleCard key={`${vehicle.vin}-${vehicle.plates}-${index}`} vehicle={vehicle} unitClass={unitClass} index={index} />)}
              </ul>
              {vehicleRows.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowAllVehicles((current) => !current)}
                  aria-expanded={showAllVehicles}
                  className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary hover:underline hover:underline-offset-4"
                >
                  {showAllVehicles ? "Mostrar menos" : `Ver todos los ${vehicleRows.length} vehículos`}
                  <ChevronDown aria-hidden className={`size-4 transition-transform ${showAllVehicles ? "rotate-180" : ""}`} />
                </button>
              ) : null}
            </div>
          ) : <HistoricalDescription value={insuredObject || null} />
        ) : null}

        {policyType === "DANOS" ? (
          <div className="space-y-3">
            {locationRows.length ? (
              <ul className="grid gap-2 lg:grid-cols-2">
                {locationRows.slice(0, 2).map((location, index) => <LocationCard key={`${location.address}-${index}`} location={location} index={index} />)}
              </ul>
            ) : <HistoricalDescription value={insuredObject || fallbackAssets[0]?.description || null} />}
            {locationRows.length > 2 ? (
              <RemainingRows label={`Ver las ${locationRows.length} ubicaciones`} count={locationRows.length - 2}>
                <ul className="grid gap-2 lg:grid-cols-2">
                  {locationRows.slice(2).map((location, index) => <LocationCard key={`${location.address}-${index + 2}`} location={location} index={index + 2} />)}
                </ul>
              </RemainingRows>
            ) : null}
            {coverageText ? <CoverageList text={coverageText} /> : null}
            {danosData?.activity && !locationRows.some((location) => location.activity === danosData.activity) ? <Field label="Actividad asegurada" value={danosData.activity} /> : null}
          </div>
        ) : null}

        {policyType === "GMM" ? (
          <div className="space-y-4">
            {personRows.length ? (
              <div className="space-y-3">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {personRows.slice(0, 3).map(({ person, isPrimary }, index) => <PersonCard key={`${person.fullName}-${index}`} person={person} fallbackPrimary={isPrimary} index={index} />)}
                </ul>
                <RemainingRows label={`Ver todas las ${personRows.length} personas`} count={personRows.length - 3}>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {personRows.slice(3).map(({ person, isPrimary }, index) => <PersonCard key={`${person.fullName}-${index + 3}`} person={person} fallbackPrimary={isPrimary} index={index + 3} />)}
                  </ul>
                </RemainingRows>
              </div>
            ) : <HistoricalDescription value={insuredObject || null} />}
            <section aria-labelledby="gmm-plan-heading" className="rounded-2xl border border-border/70 p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><CircleDollarSign aria-hidden className="size-4" /></span>
                <h3 id="gmm-plan-heading" className="text-sm font-semibold text-foreground">Plan y condiciones</h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Plan" value={gmmData?.plan || null} />
                <Field label="Suma asegurada" value={gmmData?.insuredAmount || null} />
                <Field label="Deducible" value={gmmData?.deductible || null} />
                <Field label="Coaseguro" value={gmmData?.coinsurance || null} />
              </div>
            </section>
          </div>
        ) : null}

        {riskDetailsReviewRequired ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            La descripción histórica requiere revisión manual. Se conserva el texto original.
          </p>
        ) : null}

        {showOriginalDescription ? (
          <details className="group rounded-xl border border-dashed border-border bg-muted/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
              <span>Ver descripción original completa</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="whitespace-pre-wrap break-words border-t border-border/70 p-3 text-sm leading-6 text-foreground">{historicalDescription}</p>
          </details>
        ) : null}

        <div className="grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Plan de pago" value={paymentPlan} />
          <Field label="Frecuencia" value={paymentFrequencyLabel || paymentFrequency} />
          {beneficiaryInfo ? <Field label="Beneficiarios" value={beneficiaryInfo} /> : null}
          {commissionRateOverride !== null ? <Field label="Tasa específica de comisión" value={`${commissionRateOverride.toFixed(2)}%`} /> : null}
        </div>

        {notes?.trim() ? (
          <details className="group rounded-xl border border-border/70 bg-muted/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
              <span>Notas de la póliza</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="whitespace-pre-wrap break-words border-t border-border/70 p-3 text-sm leading-6 text-foreground">{notes}</p>
          </details>
        ) : null}

        {policyType !== "AUTO" && policyType !== "DANOS" && policyType !== "GMM" && (riskDetailsReviewRequired || notes || fallbackAssets.length || insuredParties.length || riskDetailEntries.length) ? (
          <details className="group rounded-xl border border-border/70 bg-muted/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
              <span>Ver datos completos del riesgo</span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-border/70 p-3">
              {riskDetailEntries.length ? <div className="grid gap-2 sm:grid-cols-2">{riskDetailEntries.map((entry) => <Field key={`${entry.label}-${entry.value}`} label={entry.label} value={entry.value} />)}</div> : null}
              {insuredParties.length ? <ul className="divide-y divide-border/70">{insuredParties.map((party) => <li key={party.id} className="py-2 text-sm">{party.fullName} <span className="text-xs text-muted-foreground">· {party.isPrimary ? "Principal" : "Secundario"}</span></li>)}</ul> : null}
              {fallbackAssets.length ? <ul className="divide-y divide-border/70">{fallbackAssets.map((asset) => <li key={asset.id} className="break-words py-2 text-sm"><span className="font-medium">{asset.description}</span>{asset.serialNumber ? <span className="block text-xs text-muted-foreground">Serie {asset.serialNumber}</span> : null}</li>)}</ul> : null}
              {insuredObject ? <HistoricalDescription value={insuredObject} /> : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
