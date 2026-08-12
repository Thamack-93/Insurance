---
name: PolicyDesk design direction
description: The accepted UI design language for PolicyDesk is a teal-sidebar analytics dashboard (per a user-supplied reference). Lists the rejected looks that must not return.
---

# PolicyDesk design direction: teal dashboard

The UI follows a user-supplied reference dashboard: deep teal sidebar, very light neutral content background, white cards with hairline borders, dark-teal primary buttons, status colors (green/amber/red/blue), clean sans typography (no serif display), and a rich /today dashboard with real-data charts (Recharts): metric cards with sparklines and month-over-month deltas, a 6-month activity line chart, a policy-status donut, an alerts panel, and a recent-policies table.

**Why:** The user rejected four looks in a row: (1) original navy/cyan SaaS, (2) "Ledger" ivory/forest/bronze ("horrible"), (3) "Porcelain Cobalt" white+blue ("demasiado blanco"), (4) "Studio Paper" cream/ink/terracotta editorial ("apagados y muertos"). The teal analytics-dashboard reference was the first one they explicitly liked ("algo así me gusta").

**How to apply:** New screens must follow this teal dashboard language; don't reintroduce cream/terracotta editorial styling, serif display headings, cobalt blue, or all-white palettes. Dashboard charts must always use real database data, never mocks.
