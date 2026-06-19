import { createPolicy } from "@/app/(dashboard)/policies/actions";
import { PolicyForm } from "@/components/forms/policy-form";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { requireUserOrRedirect } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildRenewalPolicyDefaults, type PolicyRenewalSource } from "@/lib/policy-renewal";
import { assertPolicyPortfolioAccess } from "@/lib/portfolio-access";
import type { PolicyFormValues } from "@/lib/validations";

function parseTelegramDraftPolicyDefaults(payloadJson: string): Partial<PolicyFormValues> {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, string | number | null | undefined>;
    return {
      policyNumber: typeof payload.policynumber === "string" ? payload.policynumber : undefined,
      clientId: typeof payload.clientid === "string" ? payload.clientid : undefined,
      insurerId: typeof payload.insurerid === "string" ? payload.insurerid : undefined,
      policyType: typeof payload.policytype === "string" ? (payload.policytype as PolicyFormValues["policyType"]) : undefined,
      startDate: typeof payload.start === "string" ? payload.start : undefined,
      endDate: typeof payload.end === "string" ? payload.end : undefined,
      premiumAmount: typeof payload.premium === "number" ? payload.premium : undefined,
      currency: typeof payload.currency === "string" ? payload.currency : undefined,
      paymentFrequency: typeof payload.frequency === "string" ? (payload.frequency as PolicyFormValues["paymentFrequency"]) : undefined,
      paymentPlan: typeof payload.paymentplan === "string" ? payload.paymentplan : undefined,
      insuredObject: typeof payload.object === "string" ? payload.object : undefined,
      beneficiaryInfo: typeof payload.beneficiary === "string" ? payload.beneficiary : undefined,
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
    };
  } catch {
    return {};
  }
}

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams?: Promise<{ telegramDraft?: string; renewalFrom?: string }>;
}) {
  const user = await requireUserOrRedirect();
  const params = (await searchParams) ?? {};
  const db = getDb();
  const [clients, insurers, mostUsedInsurer] = await Promise.all([
    db.client.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { status: "ACTIVE" },
      _count: { insurerId: true },
      orderBy: { _count: { insurerId: "desc" } },
      take: 1,
    }),
  ]);

  let telegramDraftDefaults: Partial<PolicyFormValues> = {};
  if (params.telegramDraft) {
    const draft = await db.telegramDraft.findFirst({
      where: {
        id: params.telegramDraft,
        userId: user.id,
        type: "POLICY_CAPTURE",
      },
      select: { payloadJson: true, status: true, expiresAt: true },
    });

    if (draft && draft.status !== "CANCELLED" && draft.expiresAt > new Date()) {
      telegramDraftDefaults = parseTelegramDraftPolicyDefaults(draft.payloadJson);
    }
  }

  let renewalSource: PolicyRenewalSource | null = null;
  if (params.renewalFrom) {
    const source = await db.policy.findUnique({
      where: { id: params.renewalFrom },
      include: {
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
      },
    });

    if (source) {
      try {
        if (user.role !== "ADMIN") {
          await assertPolicyPortfolioAccess(source.id, user.id);
        }
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
