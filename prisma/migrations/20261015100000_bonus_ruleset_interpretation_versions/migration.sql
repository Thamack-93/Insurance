-- A source PDF can have multiple approved interpretations as rules are clarified.
-- Keep the PDF hash on every version, while allowing versioned rulesJson records.
DROP INDEX IF EXISTS "BonusRuleSet_organizationId_sourceHash_programKey_key";
