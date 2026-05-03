import { createInsurer } from "@/app/(dashboard)/insurers/actions";
import { InsurerForm } from "@/components/forms/insurer-form";
import { createInsurerDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";

export default async function NewInsurerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          eyebrow="Catálogo"
          title="Nueva aseguradora"
          description="Agrega una nueva compañía aseguradora al sistema."
        />

        <InsurerForm
          title="Nueva aseguradora"
          description="Completa los datos para registrar una nueva compañía aseguradora."
          submitLabel="Crear aseguradora"
          cancelHref="/insurers"
          defaultValues={createInsurerDefaults()}
          submitAction={createInsurer}
        />
      </div>
    </div>
  );
}
