-- Performance: speed up commissions ordering/filtering by expected date in dashboards.
CREATE INDEX IF NOT EXISTS "Commission_expectedDate_idx" ON "Commission"("expectedDate");
