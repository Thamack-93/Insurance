function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function validateDeploymentInfrastructure(input: {
  triggers: Array<{ name: string; enabled: string; definition: string; functionName: string }>;
  functionDefinition: string;
  constraints: Array<{ name: string; definition: string }>;
}) {
  const expectedNames = new Set(["DeploymentIdentity_guard", "DeploymentIdentity_truncate_guard"]);
  const triggerByName = new Map(input.triggers.map((trigger) => [trigger.name, trigger]));
  const row = triggerByName.get("DeploymentIdentity_guard");
  const truncate = triggerByName.get("DeploymentIdentity_truncate_guard");
  const rowDef = normalized(row?.definition ?? "");
  const truncateDef = normalized(truncate?.definition ?? "");
  const triggersValid = input.triggers.length === expectedNames.size
    && input.triggers.every((trigger) => expectedNames.has(trigger.name)
      && trigger.enabled === "O"
      && trigger.functionName === "policydesk_guard_deployment_identity")
    && Boolean(rowDef.includes("before insert or delete or update") || rowDef.includes("before insert or update or delete"))
    && rowDef.includes("for each row")
    && truncateDef.includes("before truncate")
    && truncateDef.includes("for each statement");
  const functionDef = normalized(input.functionDefinition);
  const functionValid = functionDef.includes("policydesk.deployment_identity_admin")
    && functionDef.includes("policydesk_deployment_identity_immutable")
    && functionDef.includes("returns trigger")
    && functionDef.includes("language plpgsql")
    && functionDef.includes("is distinct from '1'")
    && functionDef.includes("if tg_op = 'delete'")
    && functionDef.includes("return old")
    && functionDef.includes("if tg_op = 'truncate'")
    && functionDef.includes("return null")
    && functionDef.includes("return new");
  const constraints = new Map(input.constraints.map((constraint) => [constraint.name, normalized(constraint.definition)]));
  const constraintsValid = constraints.size === 3
    && (constraints.get("DeploymentIdentity_pkey") ?? "").includes("primary key (id)")
    && (constraints.get("DeploymentIdentity_singleton_id_check") ?? "").includes("policydesk_deployment_identity_v1")
    && (constraints.get("DeploymentIdentity_fingerprint_check") ?? "").includes("^[a-f0-9]{64}$");
  return { triggersValid, functionValid, constraintsValid };
}
