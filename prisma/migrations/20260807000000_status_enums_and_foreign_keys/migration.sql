-- Task 8 — Enums de estatus y llaves foráneas
--
-- Estrategia obligatoria: NORMALIZAR primero, RESTRINGIR después. Todo el
-- archivo corre dentro de una sola transacción, así que o se aplica completo o
-- no se aplica nada; nunca puede quedar una tabla a medias.
--
-- Inventario previo (base productiva, 2026-08-07): ninguna columna de estatus
-- contenía valores fuera del conjunto permitido y ninguna marca de duplicado
-- apuntaba a un registro inexistente. Aun así la normalización se deja escrita
-- para que la migración sea segura si los datos cambian antes de aplicarse.

-- ---------------------------------------------------------------------------
-- 1. Tipos enum
-- ---------------------------------------------------------------------------

CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'PENDING', 'RENEWED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "EndorsementStatus" AS ENUM ('ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED');
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "CommissionStatus" AS ENUM ('EXPECTED', 'PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'RESOLVED', 'CANCELLED');
CREATE TYPE "QuoteStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "WorkItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED', 'DISMISSED');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'RESOLVED');

-- ---------------------------------------------------------------------------
-- 2. Normalización de los datos existentes
--
-- Paso a: se corrigen diferencias de mayúsculas/espacios, que es la forma en
--         que un script o una importación suele introducir un valor "nuevo".
-- Paso b: cualquier valor que siga sin pertenecer al conjunto se lleva al
--         estado por defecto de la columna y se reporta con RAISE NOTICE para
--         que quede registrado en la salida de la migración.
-- ---------------------------------------------------------------------------

-- Client
UPDATE "Client" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Client" WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Client.status: valores desconocidos normalizados a ACTIVE: %', stray;
  END IF;
END $$;

UPDATE "Client" SET "status" = 'ACTIVE'
WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- Insurer
UPDATE "Insurer" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Insurer" WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Insurer.status: valores desconocidos normalizados a ACTIVE: %', stray;
  END IF;
END $$;

UPDATE "Insurer" SET "status" = 'ACTIVE'
WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- Policy
UPDATE "Policy" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Policy" WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'PENDING', 'RENEWED', 'EXPIRED', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Policy.status: valores desconocidos normalizados a ACTIVE: %', stray;
  END IF;
END $$;

UPDATE "Policy" SET "status" = 'ACTIVE'
WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'PENDING', 'RENEWED', 'EXPIRED', 'CANCELLED');

-- PolicyEndorsement
UPDATE "PolicyEndorsement" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "PolicyEndorsement" WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'PolicyEndorsement.status: valores desconocidos normalizados a ACTIVE: %', stray;
  END IF;
END $$;

UPDATE "PolicyEndorsement" SET "status" = 'ACTIVE'
WHERE "status" IS NULL OR "status" NOT IN ('ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED');

-- Receipt
UPDATE "Receipt" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Receipt" WHERE "status" IS NULL OR "status" NOT IN ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Receipt.status: valores desconocidos normalizados a PENDING: %', stray;
  END IF;
END $$;

UPDATE "Receipt" SET "status" = 'PENDING'
WHERE "status" IS NULL OR "status" NOT IN ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- Payment
UPDATE "Payment" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Payment" WHERE "status" IS NULL OR "status" NOT IN ('POSTED', 'REVERSED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Payment.status: valores desconocidos normalizados a POSTED: %', stray;
  END IF;
END $$;

UPDATE "Payment" SET "status" = 'POSTED'
WHERE "status" IS NULL OR "status" NOT IN ('POSTED', 'REVERSED');

-- Commission
UPDATE "Commission" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Commission" WHERE "status" IS NULL OR "status" NOT IN ('EXPECTED', 'PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Commission.status: valores desconocidos normalizados a EXPECTED: %', stray;
  END IF;
END $$;

UPDATE "Commission" SET "status" = 'EXPECTED'
WHERE "status" IS NULL OR "status" NOT IN ('EXPECTED', 'PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- Claim
UPDATE "Claim" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Claim" WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'RESOLVED', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Claim.status: valores desconocidos normalizados a OPEN: %', stray;
  END IF;
END $$;

UPDATE "Claim" SET "status" = 'OPEN'
WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'RESOLVED', 'CANCELLED');

-- Quote
UPDATE "Quote" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Quote" WHERE "status" IS NULL OR "status" NOT IN ('REQUESTED', 'IN_PROGRESS', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Quote.status: valores desconocidos normalizados a REQUESTED: %', stray;
  END IF;
END $$;

UPDATE "Quote" SET "status" = 'REQUESTED'
WHERE "status" IS NULL OR "status" NOT IN ('REQUESTED', 'IN_PROGRESS', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- Task
UPDATE "Task" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Task" WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Task.status: valores desconocidos normalizados a OPEN: %', stray;
  END IF;
END $$;

UPDATE "Task" SET "status" = 'OPEN'
WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED');

-- WorkItem
UPDATE "WorkItem" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "WorkItem" WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED', 'DISMISSED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'WorkItem.status: valores desconocidos normalizados a OPEN: %', stray;
  END IF;
END $$;

UPDATE "WorkItem" SET "status" = 'OPEN'
WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT', 'RESOLVED', 'CANCELLED', 'ARCHIVED', 'DISMISSED');

-- Alert
UPDATE "Alert" SET "status" = upper(btrim("status"))
WHERE "status" <> upper(btrim("status"));

DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO stray
  FROM "Alert" WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'DISMISSED', 'RESOLVED');
  IF stray IS NOT NULL THEN
    RAISE NOTICE 'Alert.status: valores desconocidos normalizados a OPEN: %', stray;
  END IF;
END $$;

UPDATE "Alert" SET "status" = 'OPEN'
WHERE "status" IS NULL OR "status" NOT IN ('OPEN', 'DISMISSED', 'RESOLVED');

-- ---------------------------------------------------------------------------
-- 3. Aplicación de la restricción
--
-- El DEFAULT se elimina antes de cambiar el tipo y se vuelve a declarar
-- después, ya tipado: Postgres no puede reinterpretar un default de texto
-- contra un enum.
-- ---------------------------------------------------------------------------

ALTER TABLE "Client" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "status" TYPE "EntityStatus" USING "status"::"EntityStatus";
ALTER TABLE "Client" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Insurer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Insurer" ALTER COLUMN "status" TYPE "EntityStatus" USING "status"::"EntityStatus";
ALTER TABLE "Insurer" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Policy" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Policy" ALTER COLUMN "status" TYPE "PolicyStatus" USING "status"::"PolicyStatus";
ALTER TABLE "Policy" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" TYPE "EndorsementStatus" USING "status"::"EndorsementStatus";
ALTER TABLE "PolicyEndorsement" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Receipt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Receipt" ALTER COLUMN "status" TYPE "ReceiptStatus" USING "status"::"ReceiptStatus";
ALTER TABLE "Receipt" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus" USING "status"::"PaymentStatus";
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'POSTED';

ALTER TABLE "Commission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Commission" ALTER COLUMN "status" TYPE "CommissionStatus" USING "status"::"CommissionStatus";
ALTER TABLE "Commission" ALTER COLUMN "status" SET DEFAULT 'EXPECTED';

ALTER TABLE "Claim" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Claim" ALTER COLUMN "status" TYPE "ClaimStatus" USING "status"::"ClaimStatus";
ALTER TABLE "Claim" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE "QuoteStatus" USING "status"::"QuoteStatus";
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "WorkItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" TYPE "WorkItemStatus" USING "status"::"WorkItemStatus";
ALTER TABLE "WorkItem" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Alert" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE "AlertStatus" USING "status"::"AlertStatus";
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- ---------------------------------------------------------------------------
-- 4. Marcas de duplicado: llaves foráneas hacia sí mismas
--
-- Al borrar el registro "padre" de un duplicado, la marca se vacía en lugar de
-- quedar apuntando al vacío (SET NULL): el hallazgo de calidad de datos sigue
-- existiendo, simplemente deja de estar emparejado.
-- ---------------------------------------------------------------------------

UPDATE "ReceiptReconciliationIssue" SET "duplicateOfId" = NULL
WHERE "duplicateOfId" IS NOT NULL
  AND "duplicateOfId" NOT IN (SELECT "id" FROM "ReceiptReconciliationIssue");

UPDATE "PolicyRenewalSuggestion" SET "duplicateOfId" = NULL
WHERE "duplicateOfId" IS NOT NULL
  AND "duplicateOfId" NOT IN (SELECT "id" FROM "PolicyRenewalSuggestion");

UPDATE "LedgerImportIssue" SET "duplicateOfId" = NULL
WHERE "duplicateOfId" IS NOT NULL
  AND "duplicateOfId" NOT IN (SELECT "id" FROM "LedgerImportIssue");

ALTER TABLE "ReceiptReconciliationIssue"
  ADD CONSTRAINT "ReceiptReconciliationIssue_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "ReceiptReconciliationIssue"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyRenewalSuggestion"
  ADD CONSTRAINT "PolicyRenewalSuggestion_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "PolicyRenewalSuggestion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
  ADD CONSTRAINT "LedgerImportIssue_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "LedgerImportIssue"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Alertas: vínculo tipado hacia la entidad que las origina
--
-- entityType/entityId se conservan porque también describen sujetos que no son
-- registros nuestros (SecurityEvent, System). Para las entidades que el usuario
-- sí puede borrar se agregan columnas tipadas con CASCADE, de modo que borrar
-- un cliente, una póliza o un recibo se lleve sus alertas en lugar de dejarlas
-- señalando a un identificador que ya no existe.
-- ---------------------------------------------------------------------------

ALTER TABLE "Alert" ADD COLUMN "clientId"  TEXT;
ALTER TABLE "Alert" ADD COLUMN "policyId"  TEXT;
ALTER TABLE "Alert" ADD COLUMN "receiptId" TEXT;

UPDATE "Alert" a SET "clientId" = c."id"
FROM "Client" c
WHERE upper(a."entityType") = 'CLIENT' AND a."entityId" = c."id";

UPDATE "Alert" a SET "policyId" = p."id"
FROM "Policy" p
WHERE upper(a."entityType") = 'POLICY' AND a."entityId" = p."id";

UPDATE "Alert" a SET "receiptId" = r."id"
FROM "Receipt" r
WHERE upper(a."entityType") = 'RECEIPT' AND a."entityId" = r."id";

CREATE INDEX "Alert_clientId_idx"  ON "Alert"("clientId");
CREATE INDEX "Alert_policyId_idx"  ON "Alert"("policyId");
CREATE INDEX "Alert_receiptId_idx" ON "Alert"("receiptId");

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Pendientes espejo de una alerta
--
-- Los pendientes creados desde una notificación duplicaban la alerta mediante
-- el par sourceType/sourceId, sin integridad: hoy existen pendientes cuya
-- alerta ya fue borrada. Se agrega la columna tipada y se rellena sólo cuando
-- la alerta existe; los pendientes huérfanos conservan su información y
-- simplemente quedan sin vínculo (no se borra ningún registro).
-- ---------------------------------------------------------------------------

ALTER TABLE "WorkItem" ADD COLUMN "sourceAlertId" TEXT;

UPDATE "WorkItem" w SET "sourceAlertId" = a."id"
FROM "Alert" a
WHERE upper(w."sourceType") IN ('NOTIFICATION', 'ALERT') AND w."sourceId" = a."id";

CREATE INDEX "WorkItem_sourceAlertId_idx" ON "WorkItem"("sourceAlertId");

ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_sourceAlertId_fkey"
  FOREIGN KEY ("sourceAlertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
