import { notFound } from "next/navigation";
import { updateInsurer } from "@/app/(dashboard)/insurers/actions";
import { InsurerForm } from "@/components/forms/insurer-form";
import { createInsurerDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function EditInsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const insurer = await db.insurer.findUnique({
    where: { id },
  });

  if (!insurer) {
    notFound();
  }

  const defaultValues = createInsurerDefaults({
    name: insurer.name,
    portalUrl: insurer.portalUrl ?? "",
    contactName: insurer.contactName ?? "",
    contactEmail: insurer.contactEmail ?? "",
    contactPhone: insurer.contactPhone ?? "",
    notes: insurer.notes ?? "",
    status: insurer.status,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          eyebrow="Catálogo"
          title={`Editar ${insurer.name}`}
          description="Actualiza los datos de la aseguradora."
        />

        <InsurerForm
          title="Editar aseguradora"
          description="Modifica la información de la compañía aseguradora."
          submitLabel="Guardar cambios"
          cancelHref={`/insurers/${id}`}
          defaultValues={defaultValues}
          submitAction={updateInsurer.bind(null, id)}
        />
      </div>
    </div>
  );
}
