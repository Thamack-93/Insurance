/**
 * Shared advisory-lock identity for scheduled jobs and the tenant cutover.
 * Keep the PostgreSQL key function (`hashtext`) aligned with this name.
 */
export const MULTI_ORG_TRANSITION_LOCK = "policydesk-multi-org-transition-v3";
