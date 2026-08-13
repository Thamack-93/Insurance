import { notFound } from "next/navigation";
import { updateQuote } from "@/app/(dashboard)/quotes/actions";
import { QuoteForm } from "@/components/forms/quote-form";
import { createQuoteDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";
import type { QuoteFormValues } from "@/lib/validations";
import {
  clientOperationalWhere,
  quoteOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const db = getDb();

  const [quote, clients, insurers] = await Promise.all([
    db.quote.findFirst({ where: { id, ...quoteOperationalWhere(scope.portfolioOwnerId, scope.organizationId) } }),
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

  if (!quote) {
    notFound();
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  const defaultValues = createQuoteDefaults({
    clientId: quote.clientId,
    insurerId: quote.insurerId ?? "",
    policyType: quote.policyType as QuoteFormValues["policyType"],
    status: quote.status as QuoteFormValues["status"],
    requestedDate: formatDateInput(quote.requestedDate),
    sentDate: formatDateInput(quote.sentDate),
    validUntil: formatDateInput(quote.validUntil),
    quotedAmount: quote.quotedAmount ? Number(quote.quotedAmount) : undefined,
    notes: quote.notes ?? "",
  });

  return (
    <div className="flex flex-col gap-6">
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
          submitAction={updateQuote.bind(null, id)}
        />
      </div>
    </div>
  );
}
