import { PageHeader } from "@/components/layout/page-header";
import { ClientForm } from "@/components/forms/client-form";
import { createClient } from "@/app/(dashboard)/clients/actions";
import type { ClientFormValues } from "@/lib/validations";

const defaultValues: ClientFormValues = {
  fullName: "",
  type: "PERSON",
  email: "",
  phone: "",
  secondaryPhone: "",
  rfc: "",
  address: "",
  preferredContactMethod: "",
  notes: "",
  status: "ACTIVE",
};

export default function NewClientPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Nuevo cliente"
          description="Crea un expediente operable con datos de contacto, estado y contexto comercial."
        />

        <ClientForm
          title="Alta de cliente"
          description="Este formulario crea el expediente base y registra el evento en ActivityLog."
          submitLabel="Crear cliente"
          cancelHref="/clients"
          defaultValues={defaultValues}
          submitAction={createClient}
        />
      </div>
    </div>
  );
}