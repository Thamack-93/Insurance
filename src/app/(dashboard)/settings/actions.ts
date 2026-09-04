"use server";

import {
  updateOrganizationSettings as updateOrganizationSettingsDal,
  updateSettings as updateSettingsDal,
  updateUserTheme as updateUserThemeDal,
  type Settings,
} from "@/lib/settings";
import { requireUser, requireSuperAdmin } from "@/lib/auth";
import type { MutationResult } from "@/lib/mutation-utils";

/** Thin authenticated wrappers around the server-only settings DAL. */
export async function updateUserTheme(theme: string): Promise<MutationResult> {
  await requireUser();
  return updateUserThemeDal(theme);
}

export async function updateSettings(settings: Partial<Settings>): Promise<MutationResult> {
  await requireSuperAdmin();
  return updateSettingsDal(settings);
}

export async function updateOrganizationSettings(settings: Partial<Settings>): Promise<MutationResult> {
  await requireUser();
  return updateOrganizationSettingsDal(settings);
}
