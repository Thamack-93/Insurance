import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { withTenantTransaction } from "@/lib/organization-context";
import {
  clientOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";
import { getPolicyOptionLabel } from "@/lib/policy-identity";

export async function GET(request: NextRequest) {
  try {
    const scope = await requireOrganizationPortfolioReadScope();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId")?.trim() ?? "";
    const policyId = searchParams.get("policyId")?.trim() ?? "";
    const selectedPolicyId = searchParams.get("selectedPolicyId")?.trim() ?? "";
    const selectedReceiptId = searchParams.get("selectedReceiptId")?.trim() ?? "";

    if ((!clientId && !policyId) || [clientId, policyId, selectedPolicyId, selectedReceiptId].some((id) => id.length > 128)) {
      return NextResponse.json({ error: "Selecciona un cliente o una póliza válida." }, { status: 400 });
    }

    const options = await withTenantTransaction(scope.context, async (db) => {
      if (clientId) {
        const client = await db.client.findFirst({
          where: { id: clientId, ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
          select: { id: true },
        });
        if (!client) throw new AuthError("No tienes acceso a este cliente.", 403);
      }

      const selectedPolicy = policyId
        ? await db.policy.findFirst({
            where: { id: policyId, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
            select: { id: true, clientId: true },
          })
        : null;
      if (policyId && !selectedPolicy) throw new AuthError("No tienes acceso a esta póliza.", 403);
      if (clientId && selectedPolicy && selectedPolicy.clientId !== clientId) {
        throw new AuthError("La póliza no pertenece al cliente seleccionado.", 403);
      }

      const includedPolicy = selectedPolicyId
        ? await db.policy.findFirst({
            where: { id: selectedPolicyId, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
            select: { id: true, clientId: true },
          })
        : null;
      if (selectedPolicyId && !includedPolicy) throw new AuthError("No tienes acceso a esta póliza.", 403);
      if (clientId && includedPolicy && includedPolicy.clientId !== clientId) {
        throw new AuthError("La póliza no pertenece al cliente seleccionado.", 403);
      }

      const includedReceipt = selectedReceiptId
        ? await db.receipt.findFirst({
            where: { id: selectedReceiptId, ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
            select: { id: true, policyId: true },
          })
        : null;
      if (selectedReceiptId && !includedReceipt) throw new AuthError("No tienes acceso a este recibo.", 403);
      if (policyId && includedReceipt && includedReceipt.policyId !== policyId) {
        throw new AuthError("El recibo no pertenece a la póliza seleccionada.", 403);
      }

      const [policies, receipts] = await Promise.all([
        clientId
          ? db.policy.findMany({
              where: {
                clientId,
                OR: [{ status: { not: "CANCELLED" } }, ...(includedPolicy ? [{ id: includedPolicy.id }] : [])],
                ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
              },
              orderBy: { policyNumber: "asc" },
              select: {
                id: true,
                policyNumber: true,
                insuredObject: true,
                insuredAssets: { select: { description: true, isPrimary: true } },
              },
            })
          : Promise.resolve([]),
        policyId
          ? db.receipt.findMany({
              where: {
                policyId,
                OR: [{ status: { not: "CANCELLED" } }, ...(includedReceipt ? [{ id: includedReceipt.id }] : [])],
                ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
              },
              orderBy: { dueDate: "asc" },
              select: { id: true, receiptNumber: true },
            })
          : Promise.resolve([]),
      ]);

      return {
        policies: policies.map((policy) => ({ value: policy.id, label: getPolicyOptionLabel(policy) })),
        receipts: receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber })),
      };
    });

    return NextResponse.json(options, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.work-items.relation-options", error);
    return NextResponse.json({ error: "No se pudieron cargar las relaciones." }, { status: 500 });
  }
}
