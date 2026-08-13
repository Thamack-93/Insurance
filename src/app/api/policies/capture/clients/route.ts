import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireOrganizationContext();
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json(
    { error: "POLICY_TENANT_MUTATION_PENDING", code: "POLICY_TENANT_MUTATION_PENDING" },
    { status: 409 },
  );
}
