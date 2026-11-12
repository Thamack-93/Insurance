"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateCommissionForReceipt } from "@/lib/commissions";
import { assertOrganizationContextInTransaction, requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";
import { businessAddDays } from "@/lib/business-dates";
import { formatDateInput, parseDateInput } from "@/lib/form-utils";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { policyRiskDetailsSchema, riskDetailsFromExisting, summarizePolicyRiskDetails } from "@/lib/policy-risk-details";
import { syncPolicyRiskRelations } from "@/lib/policy-risk-relations";
import { VEHICLE_UNIT_CLASS_VALUES } from "@/lib/vehicle-unit-classes";

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
        receipt: { organizationId: context.organizationId, commissionCalculationStatus: { in: ["NOT_CALCULATED", "REVIEW"] }, commissions: { none: {} } },
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

const fixVehicleClassSchema = z.object({
  policyId: z.string().trim().min(1).max(100),
  receiptId: z.string().trim().min(1).max(100),
  vehicleIndex: z.number().int().min(0).max(99),
  unitClass: z.enum(VEHICLE_UNIT_CLASS_VALUES),
});

export async function fixCommissionVehicleClass(input: unknown): Promise<{ saved: boolean; calculated: boolean; message: string }> {
  const parsedInput = fixVehicleClassSchema.safeParse(input);
  if (!parsedInput.success) return { saved: false, calculated: false, message: "Selecciona un tipo de unidad válido." };

  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const { policyId, receiptId, vehicleIndex, unitClass } = parsedInput.data;
    const updated = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const receipt = await tx.receipt.findFirst({
        where: {
          id: receiptId,
          policyId,
          organizationId: context.organizationId,
          commissionCalculationStatus: "REVIEW",
          commissionReviewReason: { contains: "Clasifica la unidad" },
          commissions: { none: { organizationId: context.organizationId } },
          payments: { some: { organizationId: context.organizationId, status: "POSTED" } },
        },
        select: {
          id: true,
          policy: {
            select: {
              id: true,
              policyType: true,
              riskDetails: true,
              insuredObject: true,
              beneficiaryInfo: true,
              insuredAssets: { select: { description: true, serialNumber: true } },
              insuredParties: { select: { fullName: true } },
            },
          },
        },
      });
      if (!receipt) return { error: "El pago ya cambió o no pertenece a una omisión corregible." };
      const { policy } = receipt;
      if (policy.policyType !== "AUTO") return { error: "La póliza ya no es de tipo AUTO." };
      const currentRisk = riskDetailsFromExisting(policy.policyType, policy.riskDetails, policy.insuredObject, policy.insuredAssets, policy.insuredParties, policy.beneficiaryInfo);
      const risk = policyRiskDetailsSchema.safeParse(currentRisk);
      if (!risk.success || risk.data.policyType !== "AUTO") return { error: "Completa los datos estructurados de vehículos en la póliza antes de recalcular." };
      const vehicles = [...risk.data.data.vehicles];
      if (policy.insuredAssets.length && vehicles.length !== policy.insuredAssets.length) return { error: "La lista de vehículos de la póliza cambió. Ábrela y completa la unidad faltante para conservar el desglose." };
      if (!vehicles[vehicleIndex]) return { error: "El vehículo ya cambió. Actualiza el reporte e inténtalo otra vez." };
      if (vehicles[vehicleIndex]!.unitClass.trim()) return { error: "El vehículo ya tiene tipo de unidad. Actualiza el reporte." };
      vehicles[vehicleIndex] = { ...vehicles[vehicleIndex]!, unitClass };
      const nextRisk = { ...risk.data, data: { ...risk.data.data, vehicles } };
      await tx.policy.update({
        where: { id: policyId, organizationId: context.organizationId },
        data: {
          riskDetails: nextRisk as unknown as Prisma.InputJsonValue,
          insuredObject: summarizePolicyRiskDetails(nextRisk),
          updatedById: context.userId,
        },
      });
      await syncPolicyRiskRelations(tx, context.organizationId, policyId, nextRisk);
      return { error: null };
    });

    if (updated.error) return { saved: false, calculated: false, message: updated.error };
    let calculation: Awaited<ReturnType<typeof calculateCommissionForReceipt>>;
    try {
      calculation = await calculateCommissionForReceipt(receiptId, policyId);
    } catch (error) {
      revalidatePath("/commissions");
      revalidatePath(`/policies/${policyId}`);
      return { saved: true, calculated: false, message: `Tipo guardado; no se pudo confirmar el recálculo: ${error instanceof Error ? error.message : "error inesperado"}` };
    }
    revalidatePath("/commissions");
    revalidatePath(`/policies/${policyId}`);
    return {
      saved: true,
      calculated: calculation.ok,
      message: calculation.ok ? "Tipo guardado y comisión calculada." : `Tipo guardado; la comisión sigue pendiente: ${calculation.error}`,
    };
  } catch (error) {
    return { saved: false, calculated: false, message: error instanceof Error ? error.message : "No se pudo corregir la comisión." };
  }
}
