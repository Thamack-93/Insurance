export const MAINTENANCE_STATS_VISIBILITY_SQL = `
  SELECT
    (r.rolsuper OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')) AS can_read_all_stats
  FROM pg_roles r
  WHERE r.rolname = current_user
`;

export async function assertMaintenanceStatsVisibility(client) {
  const result = await client.query(MAINTENANCE_STATS_VISIBILITY_SQL);
  if (result.rows[0]?.can_read_all_stats !== true) {
    throw new Error("MAINTENANCE_STATS_VISIBILITY_REQUIRED");
  }
}
