import { notFound } from "next/navigation";
import { updatePolicy } from "@/app/(dashboard)/policies/actions";
import { PolicyForm } from "@/components/forms/policy-form";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [policy, clients, insurers] = await Promise.all([
    db.policy.findUnique({ where: { id } }),
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
  ]);

  if (!policy) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={`Editar ${policy.policyNumber}`}
          description="Ajusta vigencia, prima o relaciones de la póliza con trazabilidad."
        />

        <PolicyForm
          title="Edición de póliza"
          description="Los cambios impactan cartera, renovaciones y pantallas financieras relacionadas."
          submitLabel="Guardar cambios"
          cancelHref={`/policies/${policy.id}`}
          defaultValues={createPolicyDefaults({
            policyNumber: policy.policyNumber,
            clientId: policy.clientId,
            insurerId: policy.insurerId,
            policyType: policy.policyType,
            status: policy.status,
            startDate: formatDateInput(policy.startDate),
            endDate: formatDateInput(policy.endDate),
            premiumAmount: Number(policy.premiumAmount),
            currency: policy.currency,
            paymentFrequency: policy.paymentFrequency,
            paymentPlan: policy.paymentPlan ?? "",
            insuredObject: policy.insuredObject ?? "",
            beneficiaryInfo: policy.beneficiaryInfo ?? "",
            notes: policy.notes ?? "",
          })}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          submitAction={updatePolicy.bind(null, policy.id)}
        />
      </div>
    </div>
  );
}
