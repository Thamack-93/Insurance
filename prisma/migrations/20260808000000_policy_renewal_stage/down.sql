-- Reversión de 20260808000000_policy_renewal_stage.
--
-- Prisma no ejecuta este archivo automáticamente; se aplica a mano con
-- `psql -1 -f down.sql` y después se borra la fila correspondiente de
-- `_prisma_migrations`.
--
-- Se pierde únicamente la etapa del tablero, que es estado de proceso
-- reconstruible: las pólizas renovadas y las rechazadas se vuelven a deducir
-- de PolicyStatus y de PolicyRenewalSuggestion.

BEGIN;

ALTER TABLE "Policy" DROP CONSTRAINT "Policy_renewalStageById_fkey";
DROP INDEX "Policy_renewalStage_endDate_idx";
DROP INDEX "Policy_renewalStageById_idx";

ALTER TABLE "Policy"
DROP COLUMN "renewalStageById",
DROP COLUMN "renewalStageAt",
DROP COLUMN "renewalStage";

DROP TYPE "RenewalStage";

COMMIT;
