"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateCommissionForReceipt } from "@/lib/commissions";
import { assertOrganizationContextInTransaction, requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";
import { businessAddDays } from "@/lib/business-dates";
import { formatDateInput, parseDateInput } from "@/lib/form-utils";

export async function generateCommissionReport(formData: FormData) {
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  const paidFromValue = String(formData.get("paidFrom") ?? "").trim();
  const paidToValue = String(formData.get("paidTo") ?? "").trim();
  const paidFrom = parseDateInput(paidFromValue);
  const paidTo = parseDateInput(paidToValue);
  if (!paidFromValue || !paidToValue || Number.isNaN(paidFrom.getTime()) || Number.isNaN(paidTo.getTime()) || formatDateInput(paidFrom) !== paidFromValue || formatDateInput(paidTo) !== paidToValue || paidFrom > paidTo) {
    throw new Error("Selecciona un rango de fechas válido.");
  }
  const paidToExclusive = businessAddDays(paidTo, 1);
  if (paidToExclusive.getTime() - paidFrom.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new Error("Genera el reporte por periodos de hasta un año.");
  }

  const receiptIds = await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const payments = await tx.payment.findMany({
      where: {
        organizationId: context.organizationId,
        status: "POSTED",
        paidDate: { gte: paidFrom, lt: paidToExclusive },
        policy: { organizationId: context.organizationId },
        receipt: { organizationId: context.organizationId, status: { not: "CANCELLED" }, commissionCalculationStatus: { in: ["NOT_CALCULATED", "REVIEW"] }, commissions: { none: {} } },
      },
      distinct: ["receiptId"],
      select: { receiptId: true },
      orderBy: { receiptId: "asc" },
    });
    return payments.map(({ receiptId }) => receiptId);
  });

  for (const receiptId of receiptIds) {
    await calculateCommissionForReceipt(receiptId);
  }

  revalidatePath("/commissions");
  redirect(`/commissions?paidFrom=${encodeURIComponent(paidFromValue)}&paidTo=${encodeURIComponent(paidToValue)}&generated=1`);
}
