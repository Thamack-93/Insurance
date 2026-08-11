import { describe, expect, it } from "vitest";
import { validateDeploymentInfrastructure } from "../../scripts/deployment-db-infrastructure";

const valid = {
  triggers: [
    { name: "DeploymentIdentity_guard", enabled: "O", definition: 'CREATE TRIGGER "DeploymentIdentity_guard" BEFORE INSERT OR DELETE OR UPDATE ON "DeploymentIdentity" FOR EACH ROW EXECUTE FUNCTION policydesk_guard_deployment_identity()', functionName: "policydesk_guard_deployment_identity" },
    { name: "DeploymentIdentity_truncate_guard", enabled: "O", definition: 'CREATE TRIGGER "DeploymentIdentity_truncate_guard" BEFORE TRUNCATE ON "DeploymentIdentity" FOR EACH STATEMENT EXECUTE FUNCTION policydesk_guard_deployment_identity()', functionName: "policydesk_guard_deployment_identity" },
  ],
  functionDefinition: "CREATE FUNCTION policydesk_guard_deployment_identity() RETURNS trigger LANGUAGE plpgsql AS $$ IF current_setting('policydesk.deployment_identity_admin', true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'POLICYDESK_DEPLOYMENT_IDENTITY_IMMUTABLE'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF; RETURN NEW; $$",
  constraints: [
    { name: "DeploymentIdentity_pkey", definition: "PRIMARY KEY (id)" },
    { name: "DeploymentIdentity_singleton_id_check", definition: "CHECK (id = 'policydesk_deployment_identity_v1')" },
    { name: "DeploymentIdentity_fingerprint_check", definition: "CHECK (fingerprint ~ '^[a-f0-9]{64}$')" },
  ],
};

describe("deployment identity physical audit", () => {
  it("accepts the expected physical definitions", () => {
    expect(validateDeploymentInfrastructure(valid)).toEqual({ triggersValid: true, functionValid: true, constraintsValid: true });
  });

  it("detects a trigger with the right name but wrong timing/events", () => {
    const altered = structuredClone(valid);
    altered.triggers[0]!.definition = 'CREATE TRIGGER "DeploymentIdentity_guard" AFTER UPDATE ON "DeploymentIdentity" FOR EACH ROW EXECUTE FUNCTION policydesk_guard_deployment_identity()';
    expect(validateDeploymentInfrastructure(altered).triggersValid).toBe(false);
  });

  it("detects permissive functions and altered constraints", () => {
    expect(validateDeploymentInfrastructure({ ...valid, functionDefinition: "CREATE FUNCTION policydesk_guard_deployment_identity() RETURNS trigger AS $$ RETURN NEW $$ LANGUAGE plpgsql" }).functionValid).toBe(false);
    const altered = structuredClone(valid);
    altered.constraints[2]!.definition = "CHECK (true)";
    expect(validateDeploymentInfrastructure(altered).constraintsValid).toBe(false);
  });

  it("detects a guard that omits a mutation return path", () => {
    const altered = valid.functionDefinition.replace("RETURN OLD", "RETURN NEW");
    expect(validateDeploymentInfrastructure({ ...valid, functionDefinition: altered }).functionValid).toBe(false);
  });
});
