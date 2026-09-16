import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { parseBusinessDateInput } from "@/lib/business-dates";
import { assertOrganizationContextInTransaction, requireOrganizationContext, requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";
import { normalizeCurrencyCode } from "@/lib/currency-rates";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export type CurrencyRateInput = {
  fromCurrency: string;
  effectiveDate: string;
  rateToMxn: string;
};

export async function getCurrencyRates() {
  const context = await requireOrganizationContext();
  return withTenantTransaction(context, (tx) => tx.currencyRate.findMany({
    where: { organizationId: context.organizationId },
    orderBy: [{ fromCurrency: "asc" }, { effectiveDate: "desc" }],
    select: { id: true, fromCurrency: true, toCurrency: true, effectiveDate: true, rateToMxn: true },
  }));
}

export async function saveCurrencyRate(input: CurrencyRateInput): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const fromCurrency = normalizeCurrencyCode(input.fromCurrency);
    const effectiveDate = parseBusinessDateInput(input.effectiveDate);
    const rateToMxn = new Prisma.Decimal(input.rateToMxn.trim());
    if (fromCurrency === "MXN" || rateToMxn.lte(0)) throw new Error("La moneda y la tasa no son válidas.");

    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      await tx.currencyRate.upsert({
        where: {
          organizationId_fromCurrency_toCurrency_effectiveDate: {
            organizationId: context.organizationId,
            fromCurrency,
            toCurrency: "MXN",
            effectiveDate,
          },
        },
        update: { rateToMxn },
        create: { organizationId: context.organizationId, fromCurrency, toCurrency: "MXN", effectiveDate, rateToMxn },
      });
    });

    return successResult(`${fromCurrency}:${input.effectiveDate}`, "/settings", "Tasa guardada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo guardar la tasa.");
  }
}

export async function deleteCurrencyRate(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      await tx.currencyRate.deleteMany({ where: { id, organizationId: context.organizationId } });
    });
    return successResult(id, "/settings", "Tasa eliminada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar la tasa.");
  }
}
