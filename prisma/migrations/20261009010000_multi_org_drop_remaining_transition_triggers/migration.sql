-- Cycle 1 registered these assignment triggers before the final protected
-- tables were added to the inventory. Remove the remaining three now that the
-- multi-organization migration has validated non-null tenant ownership.
DROP TRIGGER IF EXISTS "ClaimChecklistItem_transition_singleton_organization" ON "ClaimChecklistItem";
DROP TRIGGER IF EXISTS "KnowledgeSource_transition_singleton_organization" ON "KnowledgeSource";
DROP TRIGGER IF EXISTS "KnowledgeChunk_transition_singleton_organization" ON "KnowledgeChunk";
