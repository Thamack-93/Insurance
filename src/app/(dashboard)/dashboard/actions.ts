"use server";

import { revalidatePath } from "next/cache";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

export async function setOnboardingDismissed(dismissed: boolean): Promise<MutationResult> {
  const value = dismissed ? "true" : "false";
  try {
    const context = await requireOrganizationContext();
    await withTenantTransaction(context, (tx) => tx.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: context.organizationId, key: "onboardingDismissed" } },
      update: { value },
      create: { organizationId: context.organizationId, key: "onboardingDismissed", value },
    }));
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return successResult(
      "",
      "/dashboard",
      dismissed ? "Guía ocultada." : "Guía reactivada.",
    );
  } catch (error) {
    logError("dashboard.setOnboardingDismissed", error, { dismissed });
    return errorResult("No se pudo actualizar la guía. Intenta de nuevo.");
  }
}

export async function dismissOnboarding(): Promise<MutationResult> {
  return setOnboardingDismissed(true);
}
