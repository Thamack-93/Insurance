import { notFound } from "next/navigation";
import { updateClient } from "@/app/(dashboard)/clients/actions";
import { ClientForm } from "@/components/forms/client-form";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const client = await db.client.findUnique({ where: { id } });

  if (!client) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={`Editar ${client.fullName}`}
          description="Actualiza el expediente del cliente sin perder trazabilidad operativa."
        />

        <ClientForm
          title="Edición de cliente"
          description="Los cambios se validan antes de guardar y se registran en ActivityLog."
          submitLabel="Guardar cambios"
          cancelHref={`/clients/${client.id}`}
          defaultValues={{
            fullName: client.fullName,
            type: client.type,
            email: client.email ?? "",
            phone: client.phone ?? "",
            secondaryPhone: client.secondaryPhone ?? "",
            rfc: client.rfc ?? "",
            address: client.address ?? "",
            preferredContactMethod: client.preferredContactMethod ?? "",
            notes: client.notes ?? "",
            status: client.status,
          }}
          submitAction={updateClient.bind(null, client.id)}
        />
      </div>
    </main>
  );
}