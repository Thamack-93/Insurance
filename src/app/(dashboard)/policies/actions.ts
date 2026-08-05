"use server";

import { errorResult, type MutationResult } from "@/lib/mutation-utils";

/** Stable fail-closed code until policy mutations receive their own tenant-aware slice. */
const TENANT_POLICY_MUTATION_BLOCKED = "POLICY_TENANT_MUTATION_PENDING";

function blockedPolicyMutation(): MutationResult {
  return errorResult(TENANT_POLICY_MUTATION_BLOCKED);
}

export async function createPolicy(_values: unknown): Promise<MutationResult> {
  void _values;
  return blockedPolicyMutation();
}

export async function updatePolicy(_id: string, _values: unknown): Promise<MutationResult> {
  void _id;
  void _values;
  return blockedPolicyMutation();
}

export async function updatePolicyQualityFields(_id: string, _values: unknown): Promise<MutationResult> {
  void _id;
  void _values;
  return blockedPolicyMutation();
}

export async function deletePolicy(_id: string): Promise<MutationResult> {
  void _id;
  return blockedPolicyMutation();
}
