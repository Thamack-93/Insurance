import { createInsurer } from "@/app/(dashboard)/insurers/actions";
import { InsurerForm } from "@/components/forms/insurer-form";
import { createInsurerDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";

export default async function NewInsurerPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
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
    </main>
  );
}
