-- Reversión de 20260807000000_status_enums_and_foreign_keys.
--
-- Prisma no ejecuta este archivo automáticamente; se aplica a mano con
-- `psql -1 -f down.sql` (la transacción envolvente es obligatoria) y después se
-- borra la fila correspondiente de `_prisma_migrations`.
--
-- La reversión no pierde datos: los enums vuelven a texto con el mismo valor y
-- las columnas tipadas que se eliminan son redundantes con el par
-- entityType/entityId y sourceType/sourceId, que nunca se dejaron de escribir.

-- 6. Pendientes espejo de una alerta
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_sourceAlertId_fkey";
DROP INDEX "WorkItem_sourceAlertId_idx";
ALTER TABLE "WorkItem" DROP COLUMN "sourceAlertId";

-- 5. Alertas
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_receiptId_fkey";
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_policyId_fkey";
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_clientId_fkey";
DROP INDEX "Alert_receiptId_idx";
DROP INDEX "Alert_policyId_idx";
DROP INDEX "Alert_clientId_idx";
ALTER TABLE "Alert" DROP COLUMN "receiptId";
ALTER TABLE "Alert" DROP COLUMN "policyId";
ALTER TABLE "Alert" DROP COLUMN "clientId";

-- 4. Marcas de duplicado
ALTER TABLE "LedgerImportIssue" DROP CONSTRAINT "LedgerImportIssue_duplicateOfId_fkey";
ALTER TABLE "PolicyRenewalSuggestion" DROP CONSTRAINT "PolicyRenewalSuggestion_duplicateOfId_fkey";
ALTER TABLE "ReceiptReconciliationIssue" DROP CONSTRAINT "ReceiptReconciliationIssue_duplicateOfId_fkey";

-- 3. Columnas de estatus de vuelta a texto
ALTER TABLE "Alert" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "WorkItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

ALTER TABLE "Claim" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Claim" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Claim" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Commission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Commission" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Commission" ALTER COLUMN "status" SET DEFAULT 'EXPECTED';

ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'POSTED';

ALTER TABLE "Receipt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Receipt" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Receipt" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Policy" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Policy" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Policy" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Insurer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Insurer" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Insurer" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Client" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Client" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 1. Tipos enum
DROP TYPE "AlertStatus";
DROP TYPE "WorkItemStatus";
DROP TYPE "TaskStatus";
DROP TYPE "QuoteStatus";
DROP TYPE "ClaimStatus";
DROP TYPE "CommissionStatus";
DROP TYPE "PaymentStatus";
DROP TYPE "ReceiptStatus";
DROP TYPE "EndorsementStatus";
DROP TYPE "PolicyStatus";
DROP TYPE "EntityStatus";
