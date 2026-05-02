import { createClaim } from "@/app/(dashboard)/claims/actions";
import { ClaimForm } from "@/components/forms/claim-form";
import { createClaimDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function NewClaimPage() {
  const db = getDb();
  const [clients, policies, insurers] = await Promise.all([
    db.client.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { policyNumber: "asc" },
      select: { id: true, policyNumber: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const policyOptions = policies.map((p) => ({ value: p.id, label: p.policyNumber }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Nuevo siniestro"
          description="Registra un nuevo siniestro en el sistema."
        />

        <ClaimForm
          title="Nuevo siniestro"
          description="Completa los datos para registrar un nuevo siniestro."
          submitLabel="Crear siniestro"
          cancelHref="/claims"
          defaultValues={createClaimDefaults()}
          clientOptions={clientOptions}
          policyOptions={policyOptions}
          insurerOptions={insurerOptions}
          submitAction={createClaim}
        />
      </div>
    </main>
  );
}
