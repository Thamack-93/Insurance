"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export async function setOnboardingDismissed(dismissed: boolean): Promise<MutationResult> {
  const db = getDb();
  const value = dismissed ? "true" : "false";
  try {
    await db.systemSetting.upsert({
      where: { key: "onboardingDismissed" },
      update: { value },
      create: { key: "onboardingDismissed", value },
    });
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
