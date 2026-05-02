import { createQuote } from "@/app/(dashboard)/quotes/actions";
import { QuoteForm } from "@/components/forms/quote-form";
import { createQuoteDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function NewQuotePage() {
  const db = getDb();
  const [clients, insurers] = await Promise.all([
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

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title="Nueva cotización"
          description="Crea una nueva cotización para un cliente."
        />

        <QuoteForm
          title="Nueva cotización"
          description="Completa los datos para generar una nueva cotización."
          submitLabel="Crear cotización"
          cancelHref="/quotes"
          defaultValues={createQuoteDefaults()}
          clientOptions={clientOptions}
          insurerOptions={insurerOptions}
          submitAction={createQuote}
        />
      </div>
    </main>
  );
}
