"use server";

import { redirect } from "next/navigation";
import { clearSelectedOrganization, selectOrganization } from "@/lib/organization-context";

export async function selectOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  if (!organizationId) redirect("/organization/select?error=missing");
  await selectOrganization(organizationId);
  redirect("/today");
}

export async function clearSelectedOrganizationAction() {
  await clearSelectedOrganization();
  redirect("/organization/select");
}
