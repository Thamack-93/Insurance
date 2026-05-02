import { notFound } from "next/navigation";
import { updateClaim } from "@/app/(dashboard)/claims/actions";
import { ClaimForm } from "@/components/forms/claim-form";
import { createClaimDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function EditClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [claim, clients, policies, insurers] = await Promise.all([
    db.claim.findUnique({ where: { id } }),
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

  if (!claim) {
    notFound();
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const policyOptions = policies.map((p) => ({ value: p.id, label: p.policyNumber }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  const defaultValues = createClaimDefaults({
    folio: claim.folio,
    clientId: claim.clientId,
    policyId: claim.policyId,
    insurerId: claim.insurerId,
    claimType: claim.claimType,
    description: claim.description ?? "",
    status: claim.status,
    incidentDate: claim.incidentDate.toISOString().split("T")[0],
    reportedDate: claim.reportedDate.toISOString().split("T")[0],
    closedDate: claim.closedDate?.toISOString().split("T")[0] ?? "",
    amountClaimed: claim.amountClaimed ? Number(claim.amountClaimed) : undefined,
    amountPaid: claim.amountPaid ? Number(claim.amountPaid) : undefined,
    notes: claim.notes ?? "",
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Editar ${claim.folio}`}
          description="Actualiza los datos del siniestro."
        />

        <ClaimForm
          title="Editar siniestro"
          description="Modifica la información del siniestro."
          submitLabel="Guardar cambios"
          cancelHref={`/claims/${id}`}
          defaultValues={defaultValues}
          clientOptions={clientOptions}
          policyOptions={policyOptions}
          insurerOptions={insurerOptions}
          submitAction={updateClaim.bind(null, id)}
        />
      </div>
    </main>
  );
}
