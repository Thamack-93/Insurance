---
name: PolicyDesk "Ledger" design direction
description: The UI was intentionally reworked away from the original navy/cyan SaaS look to the "Ledger" system — warm ivory, deep forest green, bronze accent, serif display typography.
---

The user explicitly asked to discard the original palette ("don't respect the current colors") and make the app feel professional, elegant, and not AI-generated. The chosen direction is "Ledger": warm ivory paper background, deep forest-green ink/sidebar, bronze signature accent, serif display headings (system serif stack via `--font-heading`, `.font-display` utility), tighter radii.

**Why:** This is a stated product-identity preference, not a code fact; future redesigns or new components should stay consistent with it.

**How to apply:** New UI work should use the semantic tokens in `src/app/globals.css` (including `--bronze` and the `--sidebar-*` set) instead of reintroducing navy/cyan/teal or adding hardcoded brand hex values. Serif display type is for headings and key numerals; body stays Geist sans.
