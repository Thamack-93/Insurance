import { createQuote } from "@/app/(dashboard)/quotes/actions";
import { QuoteForm } from "@/components/forms/quote-form";
import { createQuoteDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { clientOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function NewQuotePage() {
  const scope = await requireOrganizationPortfolioReadScope();
  const db = getDb();
  const [clients, insurers] = await Promise.all([
    db.client.findMany({
      where: {
        ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        status: { not: "ARCHIVED" },
      },
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
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
