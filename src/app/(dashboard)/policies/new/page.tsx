import { createPolicy } from "@/app/(dashboard)/policies/actions";
import { PolicyForm } from "@/components/forms/policy-form";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserOrRedirect } from "@/lib/auth";
import { buildRenewalPolicyDefaults, type PolicyRenewalSource } from "@/lib/policy-renewal";
import { clientOperationalWhere, policyOperationalWhere } from "@/lib/portfolio-access";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import type { PolicyFormValues } from "@/lib/validations";
import { riskDetailsFromExisting } from "@/lib/policy-risk-details";

type TelegramDraftAiReview = {
  summary: string;
  warnings: string[];
  suggestions: string[];
};

function parseTelegramDraftPolicyDefaults(payloadJson: string): Partial<PolicyFormValues> {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, string | number | null | undefined>;
    const nestedPolicy =
      typeof payload.policy === "object" && payload.policy !== null
        ? (payload.policy as Record<string, string | number | null | undefined>)
        : null;
    const readString = (...values: Array<string | number | null | undefined>) =>
      values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    const readNumber = (...values: Array<string | number | null | undefined>) =>
      values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
    return {
      policyNumber:
        readString(payload.policynumber, nestedPolicy?.policyNumber, nestedPolicy?.policynumber) ?? undefined,
      clientId: readString(payload.clientid, nestedPolicy?.clientid, nestedPolicy?.clientId) ?? undefined,
      insurerId: readString(payload.insurerid, nestedPolicy?.insurerid, nestedPolicy?.insurerId) ?? undefined,
      policyType:
        (readString(payload.policytype, nestedPolicy?.policyType, nestedPolicy?.type) as PolicyFormValues["policyType"] | undefined) ??
        undefined,
      startDate: readString(payload.start, nestedPolicy?.startDate) ?? undefined,
      endDate: readString(payload.end, nestedPolicy?.endDate) ?? undefined,
      premiumAmount: readNumber(payload.premium, nestedPolicy?.premiumAmount) ?? undefined,
      currency: readString(payload.currency, nestedPolicy?.currency) ?? undefined,
      paymentFrequency:
        (readString(payload.frequency, nestedPolicy?.paymentFrequency) as PolicyFormValues["paymentFrequency"] | undefined) ??
        undefined,
      paymentPlan: readString(payload.paymentplan, nestedPolicy?.paymentPlan) ?? undefined,
      insuredObject: readString(payload.object, nestedPolicy?.insuredObject) ?? undefined,
      beneficiaryInfo: readString(payload.beneficiary, nestedPolicy?.beneficiaryInfo) ?? undefined,
      notes: readString(payload.notes, nestedPolicy?.notes) ?? undefined,
    };
  } catch {
    return {};
  }
}

function parseTelegramDraftAiReview(payloadJson: string): TelegramDraftAiReview | null {
  try {
    const payload = JSON.parse(payloadJson) as { aiReview?: unknown };
    if (!payload.aiReview || typeof payload.aiReview !== "object") return null;
    const review = payload.aiReview as Record<string, unknown>;
    if (typeof review.summary !== "string") return null;
    return {
      summary: review.summary,
      warnings: Array.isArray(review.warnings)
        ? review.warnings.filter((value): value is string => typeof value === "string").slice(0, 6)
        : [],
      suggestions: Array.isArray(review.suggestions)
        ? review.suggestions.filter((value): value is string => typeof value === "string").slice(0, 6)
        : [],
    };
  } catch {
    return null;
  }
}

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams?: Promise<{ telegramDraft?: string; renewalFrom?: string }>;
}) {
  const user = await requireUserOrRedirect();
  const context = await requireOrganizationContext();
  const params = (await searchParams) ?? {};
  const portfolioOwnerId = context.membershipRole === "ADMIN" || context.membershipRole === "OWNER" ? undefined : context.userId;
  const [clients, insurers, mostUsedInsurer] = await withTenantTransaction(context, (db) => Promise.all([
    db.client.findMany({
      where: { status: { not: "ARCHIVED" }, ...clientOperationalWhere(portfolioOwnerId, context.organizationId) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" }, organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { status: "ACTIVE", ...policyOperationalWhere(portfolioOwnerId, context.organizationId) },
      _count: { insurerId: true },
      orderBy: { _count: { insurerId: "desc" } },
      take: 1,
    }),
  ]));

  let telegramDraftDefaults: Partial<PolicyFormValues> = {};
  let telegramAiReview: TelegramDraftAiReview | null = null;
  if (params.telegramDraft) {
    const draft = await withTenantTransaction(context, (db) => db.telegramDraft.findFirst({
      where: {
        id: params.telegramDraft,
        organizationId: context.organizationId,
        userId: user.id,
        type: "POLICY_CAPTURE",
      },
      select: { payloadJson: true, status: true, expiresAt: true },
    }));

    if (draft && draft.status !== "CANCELLED" && draft.expiresAt > new Date()) {
      telegramDraftDefaults = parseTelegramDraftPolicyDefaults(draft.payloadJson);
      telegramAiReview = parseTelegramDraftAiReview(draft.payloadJson);
    }
  }

  let renewalSource: PolicyRenewalSource | null = null;
  if (params.renewalFrom) {
    const source = await withTenantTransaction(context, (db) => db.policy.findFirst({
      where: { id: params.renewalFrom, ...policyOperationalWhere(portfolioOwnerId, context.organizationId) },
      include: {
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
        insuredAssets: { select: { description: true, serialNumber: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
    }));

    if (source) {
      try {
        renewalSource = {
          id: source.id,
          policyNumber: source.policyNumber,
          clientId: source.clientId,
          clientName: source.client.fullName,
          insurerId: source.insurerId,
          insurerName: source.insurer.name,
          policyType: source.policyType as PolicyRenewalSource["policyType"],
          startDate: source.startDate,
          endDate: source.endDate,
          premiumAmount: Number(source.premiumAmount),
          currency: source.currency as PolicyRenewalSource["currency"],
          paymentFrequency: source.paymentFrequency as PolicyRenewalSource["paymentFrequency"],
          paymentPlan: source.paymentPlan,
          insuredObject: source.insuredObject,
          riskDetails: riskDetailsFromExisting(source.policyType, source.riskDetails, source.insuredObject, source.insuredAssets, source.insuredParties, source.beneficiaryInfo),
          beneficiaryInfo: source.beneficiaryInfo,
          notes: source.notes,
        };
      } catch {
        renewalSource = null;
      }
    }
  }

  const defaultInsurerId = mostUsedInsurer[0]?.insurerId;
  const telegramDraftOverrides = Object.fromEntries(
    Object.entries(telegramDraftDefaults).filter(([, value]) => value !== undefined),
  ) as Partial<PolicyFormValues>;
  const renewalDefaults = renewalSource ? buildRenewalPolicyDefaults(renewalSource) : {};
  const smartDefaults = createPolicyDefaults({
    ...(defaultInsurerId && insurers.some((i) => i.id === defaultInsurerId)
      ? { insurerId: defaultInsurerId }
      : {}),
    ...telegramDraftOverrides,
    ...renewalDefaults,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Nueva póliza"
          description="Registra una cobertura nueva con fechas, prima y relaciones operativas."
        />

        {renewalSource ? (
          <p className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Se copiaron los datos del riesgo y asegurados de la póliza anterior. Revisa la información antes de guardar.
          </p>
        ) : null}

        {telegramAiReview ? (
          <Card className="border-amber-200/80 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20">
            <CardHeader>
              <CardTitle className="text-base">Revisión IA del PDF enviado por Telegram</CardTitle>
              <CardDescription>{telegramAiReview.summary}</CardDescription>
            </CardHeader>
            {(telegramAiReview.warnings.length > 0 || telegramAiReview.suggestions.length > 0) ? (
              <CardContent className="grid gap-4 text-sm md:grid-cols-2">
                <div>
                  <p className="font-medium">Observaciones</p>
                  {telegramAiReview.warnings.map((warning) => <p key={warning} className="mt-1 text-muted-foreground">· {warning}</p>)}
                </div>
                <div>
                  <p className="font-medium">Sugerencias</p>
                  {telegramAiReview.suggestions.map((suggestion) => <p key={suggestion} className="mt-1 text-muted-foreground">· {suggestion}</p>)}
                </div>
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        <PolicyForm
          title="Alta de póliza"
          description="La póliza queda conectada con cliente, aseguradora, renovaciones y finanzas."
          submitLabel="Crear póliza"
          cancelHref="/policies"
          defaultValues={smartDefaults}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          renewalSource={renewalSource}
          showRenewalLink={true}
          submitAction={createPolicy}
        />
      </div>
    </div>
  );
}
