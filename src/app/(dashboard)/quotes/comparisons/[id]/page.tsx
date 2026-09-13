import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { QuoteComparisonTable } from "@/components/quotes/quote-comparison-table";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { withTenantTransaction } from "@/lib/organization-context";

export default async function QuoteComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const comparison = await withTenantTransaction(scope.context, (db) => db.quoteComparison.findFirst({
    where: { id, organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { client: { portfolioOwnerId: scope.portfolioOwnerId } } : {}) },
    include: { client: { select: { fullName: true } }, items: { include: { quote: { select: { id: true, insurer: { select: { name: true } }, quotedAmount: true } } } } },
  }));
  if (!comparison) notFound();
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4"><PageHeader eyebrow="Cotizaciones" title="Comparación de auto" description={`Cliente: ${comparison.client.fullName}`} /><QuoteComparisonTable comparison={{ id: comparison.id, version: comparison.version, selectedQuoteId: comparison.selectedQuoteId, items: comparison.items.map((item) => ({ quoteId: item.quoteId, quoteLabel: item.quote.insurer?.name ?? "Aseguradora no especificada", terms: item.termsJson, reviewStatus: item.reviewStatus })) }} /></div>;
}
