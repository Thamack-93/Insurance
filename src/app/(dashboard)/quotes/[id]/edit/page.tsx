import { notFound } from "next/navigation";
import { updateQuote } from "@/app/(dashboard)/quotes/actions";
import { QuoteForm } from "@/components/forms/quote-form";
import { createQuoteDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [quote, clients, insurers] = await Promise.all([
    db.quote.findUnique({ where: { id } }),
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

  if (!quote) {
    notFound();
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  const defaultValues = createQuoteDefaults({
    clientId: quote.clientId,
    insurerId: quote.insurerId ?? "",
    policyType: quote.policyType,
    status: quote.status,
    requestedDate: quote.requestedDate.toISOString().split("T")[0],
    sentDate: quote.sentDate?.toISOString().split("T")[0] ?? "",
    validUntil: quote.validUntil?.toISOString().split("T")[0] ?? "",
    quotedAmount: quote.quotedAmount ? Number(quote.quotedAmount) : undefined,
    notes: quote.notes ?? "",
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title={`Editar cotización ${quote.id.slice(0, 8)}`}
          description="Actualiza los datos de la cotización."
        />

        <QuoteForm
          title="Editar cotización"
          description="Modifica la información de la cotización."
          submitLabel="Guardar cambios"
          cancelHref={`/quotes/${id}`}
          defaultValues={defaultValues}
          clientOptions={clientOptions}
          insurerOptions={insurerOptions}
          submitAction={(values) => updateQuote(id, values)}
        />
      </div>
    </main>
  );
}
