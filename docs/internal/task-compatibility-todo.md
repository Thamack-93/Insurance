# Task Compatibility TODO

Keep this compatibility layer until WorkItem coverage fully replaces Task-based flows.

Can remove once coverage is complete:

- `src/lib/work-items.ts` Task-to-WorkItem bridging and legacy `sourceType: "Task"` reads.
- `src/app/(dashboard)/tasks/actions.ts` mutation aliases that still accept Task-shaped payloads.
- `src/lib/search.ts` Task search compatibility and aliases in the global search index.
- `src/lib/risk-engine.ts` Task-backed work-item fallbacks used only for migration safety.
- `src/lib/assistant-actions.ts` Task entity support in assistant-driven drafts.
