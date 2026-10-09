import assert from "node:assert/strict";
import test from "node:test";
import { assertMaintenanceStatsVisibility, MAINTENANCE_STATS_VISIBILITY_SQL } from "./maintenance-stats-visibility.mjs";

test("maintenance accepts a role that can read every transaction statistic", async () => {
  let queryText;
  await assertMaintenanceStatsVisibility({
    async query(sql) {
      queryText = sql;
      return { rows: [{ can_read_all_stats: true }] };
    },
  });
  assert.match(queryText, /pg_read_all_stats/);
  assert.match(queryText, /rolsuper/);
});

test("maintenance fails closed when transaction statistics are hidden", async () => {
  await assert.rejects(
    assertMaintenanceStatsVisibility({ async query() { return { rows: [{ can_read_all_stats: false }] }; } }),
    { message: "MAINTENANCE_STATS_VISIBILITY_REQUIRED" },
  );
});

test("maintenance fails closed if the current role cannot be resolved", async () => {
  await assert.rejects(
    assertMaintenanceStatsVisibility({ async query() { return { rows: [] }; } }),
    { message: "MAINTENANCE_STATS_VISIBILITY_REQUIRED" },
  );
});
