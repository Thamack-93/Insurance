"use server";

import { errorResult, type MutationResult } from "@/lib/mutation-utils";
import type { EndorsementFormValues } from "@/lib/validations";

const TENANT_POLICY_MUTATION_BLOCKED = "POLICY_TENANT_MUTATION_PENDING";

export async function createEndorsement(_values: EndorsementFormValues): Promise<MutationResult> {
  void _values;
  return errorResult(TENANT_POLICY_MUTATION_BLOCKED);
}

export async function updateEndorsement(_id: string, _values: EndorsementFormValues): Promise<MutationResult> {
  void _id;
  void _values;
  return errorResult(TENANT_POLICY_MUTATION_BLOCKED);
}

export async function deleteEndorsement(_id: string): Promise<MutationResult> {
  void _id;
  return errorResult(TENANT_POLICY_MUTATION_BLOCKED);
}
