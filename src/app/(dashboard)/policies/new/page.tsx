import { createPolicy } from "@/app/(dashboard)/policies/actions";
import { PolicyForm } from "@/components/forms/policy-form";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function NewPolicyPage() {
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

  const defaultInsurerId = mostUsedInsurer[0]?.insurerId;
  const defaults = createPolicyDefaults();
  const smartDefaults =
    defaultInsurerId && insurers.some((i) => i.id === defaultInsurerId)
      ? { ...defaults, insurerId: defaultInsurerId }
      : defaults;

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
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
          submitAction={createPolicy}
        />
      </div>
    </main>
  );
}
