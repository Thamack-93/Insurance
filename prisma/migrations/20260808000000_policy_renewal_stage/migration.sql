-- Task 12 — Etapa de renovación (tablero tipo pipeline)
--
-- La renovación pasa de ser una consulta a ser un proceso con estado. La etapa
-- vive en la póliza porque es exactamente la póliza que está por vencer la que
-- avanza por el embudo; la elegibilidad (PolicyStatus + sugerencias
-- rechazadas) y la cadena de renovación (renewedFromPolicyId) no se tocan.
--
-- Todo corre dentro de una transacción: o queda el enum con su columna,
-- su índice y su llave foránea, o no queda nada.

BEGIN;

CREATE TYPE "RenewalStage" AS ENUM ('PENDING', 'CONTACTED', 'QUOTED', 'WON', 'LOST');

ALTER TABLE "Policy"
ADD COLUMN "renewalStage" "RenewalStage" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "renewalStageAt" TIMESTAMP(3),
ADD COLUMN "renewalStageById" TEXT;

-- Las pólizas ya renovadas arrancan en la columna correcta: su estatus RENEWED
-- es la huella que dejó el alta de renovación existente.
UPDATE "Policy"
SET "renewalStage" = 'WON', "renewalStageAt" = "updatedAt"
WHERE "status" = 'RENEWED';

-- Las que ya se marcaron como "no renueva" arrancan como perdidas.
UPDATE "Policy" p
SET "renewalStage" = 'LOST', "renewalStageAt" = "updatedAt"
WHERE p."renewalStage" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "PolicyRenewalSuggestion" s
    WHERE s."sourcePolicyId" = p."id" AND s."status" = 'DECLINED'
  );

CREATE INDEX "Policy_renewalStageById_idx" ON "Policy"("renewalStageById");
CREATE INDEX "Policy_renewalStage_endDate_idx" ON "Policy"("renewalStage", "endDate");

ALTER TABLE "Policy"
ADD CONSTRAINT "Policy_renewalStageById_fkey"
FOREIGN KEY ("renewalStageById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
