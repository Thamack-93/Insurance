"use server";

import { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { parseCommissionRules, type CommissionRule } from "@/lib/commissions.logic";
import { commissionRuleSchema, type CommissionRuleFormValues } from "@/lib/validations";

const DIMENSIONS = ["policyType", "productPlan", "policyMode", "unitClass", "paymentFrequency"] as const;

function overlaps(left: CommissionRule, right: CommissionRule) {
  return left.validFrom <= (right.validTo ?? "9999-12-31") && right.validFrom <= (left.validTo ?? "9999-12-31");
}

export async function saveCommissionRuleAction(values: CommissionRuleFormValues): Promise<MutationResult> {
  const parsed = commissionRuleSchema.safeParse(values);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? "Revisa los datos de la regla.");
  try {
    const context = await requireOrganizationContext();
    if (!( ["OWNER", "ADMIN"] as string[]).includes(context.membershipRole)) return errorResult("Solo Owner o Admin puede editar reglas de comisión.");
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const insurer = await tx.insurer.findFirst({ where: { id: parsed.data.insurerId, organizationId: context.organizationId }, select: { id: true, name: true, commissionRules: true, commissionRulesVersion: true } });
      if (!insurer) throw new Error("La aseguradora no pertenece a esta organización.");
      if (insurer.commissionRulesVersion !== parsed.data.expectedVersion) throw new Error("Las reglas cambiaron. Actualiza la página y vuelve a guardar.");

      const rules = parseCommissionRules(insurer.commissionRules);
      const id = parsed.data.id || crypto.randomUUID();
      const next: CommissionRule = {
        id,
        policyType: parsed.data.policyType,
        productPlan: parsed.data.productPlan,
        policyMode: parsed.data.policyMode,
        unitClass: parsed.data.unitClass,
        paymentFrequency: parsed.data.paymentFrequency,
        rate: parsed.data.rate,
        validFrom: parsed.data.validFrom,
        validTo: parsed.data.validTo || null,
        active: parsed.data.active,
        evidence: parsed.data.evidence,
      };
      if (!rules.some((rule) => rule.id === id) && parsed.data.id) throw new Error("La regla ya no existe.");
      const conflicting = rules.some((rule) => rule.id !== id && rule.active && next.active
        && DIMENSIONS.every((dimension) => rule[dimension] === next[dimension]) && overlaps(rule, next));
      if (conflicting) throw new Error("Ya existe una regla activa con las mismas dimensiones y fechas.");
      const nextRules = [...rules.filter((rule) => rule.id !== id), next];
      const update = await tx.insurer.updateMany({
        where: { id: insurer.id, organizationId: context.organizationId, commissionRulesVersion: parsed.data.expectedVersion },
        data: { commissionRules: nextRules as unknown as Prisma.InputJsonValue, commissionRulesVersion: { increment: 1 } },
      });
      if (update.count !== 1) throw new Error("Las reglas cambiaron. Actualiza la página y vuelve a guardar.");
      await writeActivityLog({ organizationId: context.organizationId, entityType: "Insurer", entityId: insurer.id, action: "COMMISSION_RULE_SAVE", oldValue: { ruleId: id }, newValue: { insurer: insurer.name, rule: next }, userId: context.userId, db: tx });
      return { id };
    });
    revalidatePaths(["/commissions", "/commissions/rules"]);
    return successResult(result.id, "/commissions/rules", "Regla de comisión guardada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo guardar la regla.");
  }
}
