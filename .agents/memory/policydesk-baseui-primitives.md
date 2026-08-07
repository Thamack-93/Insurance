---
name: The UI kit is Base UI, not Radix
description: Three non-obvious differences that compile fine (or render fine) and then break at runtime.
---

The shadcn-looking components in `components/ui` wrap `@base-ui/react`, not Radix.
Habits from Radix produce errors that are hard to trace back to the primitive.

**Why:** the props have the same names in most places, so the mismatch only
surfaces on the three cases below — one at compile time, two at runtime.

**How to apply:** when adding a dropdown, select, or dialog trigger:

1. There is no `asChild`. Pass the child as an element to `render`:
   `<DropdownMenuTrigger render={<Button variant="outline" />}>Texto</DropdownMenuTrigger>`.
   The trigger's own children become the button's content; give the rendered
   element its props (`type`, `disabled`, `aria-label`), not the trigger.
   With `asChild` the error is a confusing `Props<unknown>` type error.
2. `DropdownMenuLabel` is a *group* label and throws
   `MenuGroupRootContext is missing` at click time unless it is inside a
   `Menu.Group`. A `DropdownMenuRadioGroup` does **not** satisfy it. For a
   single radio group, drop the label and put `aria-label` on the group.
3. `Select` renders the raw *value* in the trigger, not the matching item's
   label, unless the root gets `items={{ value: label }}`. This is why filters
   built on the shared `ColumnFilter` show `__all__` instead of their
   placeholder — pass `items` when the label matters.
