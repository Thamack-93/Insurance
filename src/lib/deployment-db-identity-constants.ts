export const DEPLOYMENT_IDENTITY_ID = "policydesk_deployment_identity_v1";

// These rows describe the environment that owns the physical database. They
// must never be copied from a source backup into a different restore target.
export const ENVIRONMENT_LOCAL_DATABASE_TABLES = new Set(["DeploymentIdentity"]);
