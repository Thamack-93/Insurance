"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationRole } from "@/lib/organization-context";
import { deleteCurrencyRate as deleteCurrencyRateDal, saveCurrencyRate as saveCurrencyRateDal, type CurrencyRateInput } from "@/lib/currency-rate-actions";
import type { MutationResult } from "@/lib/mutation-utils";

export async function saveCurrencyRate(input: CurrencyRateInput): Promise<MutationResult> {
  await requireOrganizationRole(["OWNER", "ADMIN"]);
  const result = await saveCurrencyRateDal(input);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function deleteCurrencyRate(id: string): Promise<MutationResult> {
  await requireOrganizationRole(["OWNER", "ADMIN"]);
  const result = await deleteCurrencyRateDal(id);
  if (result.ok) revalidatePath("/settings");
  return result;
}
