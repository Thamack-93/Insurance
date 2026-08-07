---
name: PolicyDesk Replit Setup Quirks
description: Non-obvious issues and fixes required to run PolicyDesk on Replit (Node.js, Next.js Turbopack, Prisma)
---

# PolicyDesk Replit Setup Quirks

## Node.js version

**Rule:** Must use `nodejs-22` module. Node 20 ships a corrupted `@next/swc-linux-x64-gnu` native binary (~19MB, "missing section headers at 130306160") that causes a SIGBUS when Next.js tries to load its SWC compiler. The correct binary is ~130MB.

**Why:** The Node 20 Replit module's `@next/swc` artifact is truncated. Node 22 installs the correct binary.

**How to apply:** If the dev server exits immediately with code 0 after "Ready", check if `@next/swc-linux-x64-gnu` is ~19MB (bad) or ~130MB (good). Fix: delete `node_modules/@next node_modules/next` then `npm install` under Node 22.

## DATABASE_URL override

Replit injects its own `DATABASE_URL` (local Postgres) at runtime, silently overriding `.env.local`. PolicyDesk uses `DATABASE_URL_UNPOOLED` as its primary connection string — both `prisma.config.ts` and `src/lib/db.ts` prefer it. Store the external Postgres URL in the `DATABASE_URL_UNPOOLED` Replit Secret.

## lucide-react Turbopack SSR error

**Rule:** Server Components must not import from `lucide-react` directly. Use `@/components/icons` instead.

**Why:** lucide-react calls `react.createContext` at module evaluation time. Turbopack's SSR bundler uses a stripped React that lacks `createContext`, causing a runtime TypeError. The `"use client"` re-export wrapper in `src/components/icons.tsx` moves the evaluation to the client bundle.

**How to apply:** Any new icon needed in a Server Component must be added to `src/components/icons.tsx`. All existing Server Components across `src/app/(dashboard)/` and `src/components/` have already been fixed to import from `@/components/icons`. `import type { LucideIcon }` is also exported from `icons.tsx`.

## mermaid / pdfjs-dist missing modules

**Rule:** If `@streamdown/mermaid` gives "Can't resolve 'mermaid'" or `pdfjs-dist/webpack.mjs` gives "module not found", the packages need reinstalling and the import path needs fixing.

**Why:** `mermaid` can be installed without `dist/mermaid.core.mjs` (corrupt npm install). `pdfjs-dist` v5 removed the `webpack.mjs` entry — the correct import is `pdfjs-dist/build/pdf.min.mjs`.

**How to apply:** Run `npm install mermaid pdfjs-dist --save` to fix mermaid. The pdfjs fix is in `src/lib/pdf-text-extraction.browser.ts` (already applied).

## allowedDevOrigins

`next.config.ts` must include `*.picard.replit.dev` and `127.0.0.1` in `allowedDevOrigins` (in addition to the existing `*.replit.dev`) for the Replit preview proxy and HMR to work correctly.
