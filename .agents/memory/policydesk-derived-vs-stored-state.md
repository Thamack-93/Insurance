---
name: Resolved outcomes are derived, never stored by the UI
description: Why terminal states in PolicyDesk (renewal won/lost, and anything like it) must come from the real flow, not from a board or list control.
---

A pipeline/board control may only write the *in-between* states of a process.
The resolved ones — "se renovó", "no renueva" — are derived from the artefacts
the real flow produces: the renewal policy that now exists, the declined
suggestion the decline action writes. A control that offers a resolved state
either delegates to that flow or is not offered at all, and a card already
resolved becomes read-only.

**Why:** letting a board write its own terminal state produces claims the data
cannot back — a renewal shown as won with no renewal policy behind it, or a
declined policy whose stored stage says otherwise. Two sources of truth for the
same outcome always drift, and the operator believes the one on screen.

**How to apply:** when adding any status control, ask which existing action
already produces that outcome. If one exists, the control calls it. Reserve the
stored column for the states no other flow owns.

The same rule governs the reminders built on top: a follow-up work item must be
closed by whatever advances or resolves the thing it nags about, and the
periodic scan must also reconcile leftovers, since the resolving path often
removes the record from the scan's own query.
