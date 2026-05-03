"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export async function dismissOnboarding(): Promise<MutationResult> {
  const db = getDb();
  try {
    await db.systemSetting.upsert({
      where: { key: "onboardingDismissed" },
      update: { value: "true" },
      create: { key: "onboardingDismissed", value: "true" },
    });
    revalidatePath("/dashboard");
    return successResult("", "/dashboard", "Guía ocultada.");
  } catch (error) {
    logError("dashboard.dismissOnboarding", error);
    return errorResult("No se pudo ocultar la guía. Intenta de nuevo.");
  }
}
