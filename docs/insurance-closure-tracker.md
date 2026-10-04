# Insurance closure tracker

Coordinator: this chat. Scope: the five Insurance project chats plus
“Corrige seguimiento de renovaciones”. No prospect access or tenant cutover is
approved until the final evidence and recovery procedure are reviewed.

## Source chats

| Chat | Thread | Transfer |
| --- | --- | --- |
| Coordina los chats del proyecto | `01a0f61d-4183-7480-b783-b034e027858a` | Coordinator / active Goal |
| Add vehicle descriptions to policies | `01a0f5e6-2b9f-72c1-90d7-6df71043b287` | Checkpoint sent; PR #73 and review notes inventoried |
| Audit PolicyDesk demo sandbox | `01a0adb3-f260-76d0-8acc-4dac70465893` | Checkpoint sent; CI/Vercel/Neon safeguards inventoried |
| Certify PolicyDesk demo access | `01a0c49b-0147-79c3-9b14-57063e8f8c2f` | Checkpoint sent; recovery and CI gates inventoried |
| Audit Demo organization support | `01a0f587-a833-7f81-a2ff-110a3f089bdd` | Checkpoint sent; DEMO implementation and proof gaps inventoried |
| Corrige seguimiento de renovaciones | `01a0fe42-c8bf-7223-9601-1b8a3cd7a4e1` | Checkpoint sent; local Operations change being transferred |

## Work and acceptance

| Workstream | Owner | Acceptance evidence | Status |
| --- | --- | --- | --- |
| Structured risk fields for all ten policy lines and conservative conversion | Coordinator + policy workstream | Migration and conversion pass on disposable PostgreSQL; dry-run and approved per-organization report; source text retained; ambiguous records marked for review; reruns do not duplicate data; PR checks green | On `f1e65f3`, unrelated edits preserve ambiguous source text and beneficiary notes persist. Changing AUTO to GMM correctly replaces stale relations and derives `insuredObject` from the new insured person (`Ana Pérez`); the E2E expected the old raw description, so that assertion was stale. Current exact-SHA browser run includes this case among its passing E2Es; conversion/report approval still pending. |
| Renewal follow-ups and Operation controls | Policy/renewal workstream | Create/link renewal closes manual and automatic follow-ups in the same transaction; reprogram/remove manual follow-up; ordinary tasks edit/cancel with original identity and authorization; focused database and browser coverage | Renewal creation and manual follow-up controls pass in the latest exact-SHA app E2E. WorkItem edit remains unverified: run `37235863045` reached `/tasks/<id>/edit` but still displayed the dashboard loading fallback. The next candidate makes Playwright wait for the full document load before asserting the form; rerun required. |
| Operational Insights | Insights workstream | `/reports/insights` provides four signal groups, grouped actionable records, current action links, group filters, 25-item pages, required organization/portfolio scope, business dates and resolved-signal disappearance; focused tenant and UI tests pass | Implemented in isolated commit `9e63aec`; typecheck, 30 focused tests, lint, navigation check and diff-check passed; full application E2E remains under repair |
| CI and certification workflow | CI workstream | Disposable tenant, application, API/E2E and restore gates pass on exact candidate SHA; maintenance begins only immediately before RLS cutover; date-sensitive billing test follows the actual test month | Run `37235863045` on `38106be803dbbfad239b8fa7ade48960efc13de7`: quality passed (including all tenant static gates), build, API, disposable organization/restore integration and forced-RLS tenant isolation passed. App E2E ended with `49 passed / 3 failed`: WorkItem editor and `/risks` remained on the dashboard loading fallback, while the agent correctly reached `/today` but the test expected a level-1 heading literally named `Hoy` that the real page does not render. The new local candidate changes `/risks` to keep its broad risk scan together but run the two quality scorings sequentially, waits for full navigation on WorkItem edit, and asserts the unique `Vistas de Hoy` navigation landmark. Focused checks pass on a temporary copy (typecheck, ESLint, 3 data-quality unit tests); exact-SHA app E2E rerun is still required. |
| DEMO safeguards and private readiness | Coordinator | Synthetic-only seed/documents, server-side DEMO restrictions, exact-SHA two-organization isolation/API/browser proof, reset/revocation proof, first normal job cycle and approved prospect access controls | Not ready: exact-SHA tenant isolation passed on `038777e`, including synthetic-client access from `/portfolio` and invisibility of Pedro's private client. Reset/revocation, multi-org production cutover and prospect access remain unverified and approval-gated. |
| Backup/restore and cutover recovery | Coordinator | Exact-SHA temporary source/restore branches; verified synthetic CUSTOMER backup containing risk fields/assets/parties/source text; required count/FK/lifecycle/reference/sequence/application-read/drift checks all pass; `RESTORE_DRILL_APP_SMOKE=0`; documented human-approved target reconnection | Not ready: no SHA-matched Neon drill. Existing disposable GitHub Actions backup/restore integration passed on `d6c9d77`; this is not remote Neon certification |
| Vercel identity and deployment | Coordinator | Commit author maps to the verified GitHub account; authorized project access; Vercel deployment and runtime URL show the exact published SHA and authenticated paths work | Preview `dpl_DM9kujWdeJvKTi6rvjcstLPYkigZ` is READY on exact SHA `38106be803dbbfad239b8fa7ade48960efc13de7`. Fetching `/api/health` returns 403 at `read_protection_bypass`; Vercel says the connected account must be authorized for the deployment's project and team. Runtime paths remain unverified, and the Vercel identity gate remains open. |

## Checkpoints already collected

- `main` at inventory time: `d1a9a60368fe94826bffafd0ec3e5e7709800438`.
- PR #73: base `d1a9a60368fe94826bffafd0ec3e5e7709800438`, head
  `66c6f25c34e92a2065d4920560414c26be22bbcd`, open and mergeable.
- Current remote PR candidate at this checkpoint: `f1e65f340c3d2136911a2d40235aa65a11aca457`; PR #73 remains open and unmerged.
- PR #73 candidate `5a1df176b6b66bdcf29bda6b354557915220a82f`; CI run `37234093917`: quality passed, tenant isolation and exact-role RLS passed, application build/API/disposable restore passed, application E2E `49 passed / 3 failed`. Logs identify `P2028` in `/settings` while onboarding and rates used parallel tenant transactions; the newest fix consolidates them. Preview `dpl_5xqypELN1RjsyYsMkbGGLoSzHzZB` is READY on the exact SHA; authenticated runtime fetch returned 403 at Vercel's protection-bypass API.
- Candidate `53940ad451d071ea3df75f817f0f7abe14b238c5`; run `37235559533` caught the static organization-metadata gate because Settings called the portfolio-scope wrapper instead of `requireOrganizationContext` directly. The fix now derives the same portfolio scope from that verified context; application and tenant jobs from `53940ad` were still running when the next candidate was prepared.
- Candidate `38106be803dbbfad239b8fa7ade48960efc13de7`; run `37235863045` passed quality, API, build, disposable organization/restore integration and forced-RLS isolation. App E2E was `49 passed / 3 failed`. Playwright traces show the WorkItem edit and `/risks` pages remained on the dashboard's “Cargando tabla” fallback. The agent redirect landed on `/today`; only the stale heading assertion failed. Preview `dpl_DM9kujWdeJvKTi6rvjcstLPYkigZ` is READY on this exact SHA, but `/api/health` is denied by Vercel protection because the connection lacks team/project authorization. A local, uncommitted follow-up changes the `/risks` read schedule and these E2E waits/assertions; it still needs an exact-SHA CI run.
- Subsequent PR head `cbfd289bd825041a7da29c1de9102b6c312223f9`; run `37224209496` reduced browser E2E to three failures (`49 passed / 3 failed`). Local worktree contains the next candidate's receipt transaction consolidation and E2E accessibility/navigation fixes; no CI evidence exists for these changes yet.
- PR head `d79a8b2cdb23601e35a14974616e595073d058e1`; CI run `37226053136` failed the quality job at `check:tenant-read-scope` on seven helper queries in `receipts/page.tsx`; the other two jobs were still running at inspection. Vercel accepted this exact SHA and began a Preview build, but it remained `BUILDING` and is superseded by the corrective candidate.
- PR head `57dd5715e4550ae83fc9ffac20c0ff4db5d19494`; CI run `37226348479` passed quality, API, tenant isolation and forced-RLS browser evidence, but failed three application E2Es (`49 passed / 3 failed`). Vercel Preview `dpl_EUqYNG7mhqf7vgn6Co1NVdaX63RQ` is READY for the exact SHA; authenticated route fetch is blocked by Vercel API 403 at deployment access.
- PR head `8804a632b4496a16d21741d0662ab2f9688ac4e0`; CI run `37229602669` failed TypeScript on duplicate `NotificationRecord` imports and `organizationKind.kind` after changing its type to a string. The next candidate removes the duplicate and compares the string directly. Vercel Preview `dpl_2AEHRqmG52HYhioCj1aKE4fiwMMm` failed the same build with `lint_or_type_error`.
- PR head `fd6c8e9594601e26821b08cd7876d1361e679074`; run `37229910710` passed quality (including lint/typecheck/unit), app build, API, disposable PostgreSQL organization transition and backup/restore integration, and full forced-RLS tenant isolation/browser checks. Application E2E ended `50 passed / 2 failed`: the ordinary WorkItem edit screen exposed no second `combobox` locator to the test, and direct agent navigation to `/settings/centro-operativo` stayed on that path instead of settling at `/today`. Corrective candidate now asserts the edit form is rendered and targets its explicit `aria-label="Estado"`; for protected agent routes it verifies the server's 307 and `/today` Location without browser navigation races. Vercel Preview `dpl_HbeaNG5UvFbC6jvDWArK9Gc8zq72` is READY on this exact SHA, but runtime fetch is denied with 403 because the Vercel connector is not authorized for the project's team/deployment.
- CI run `37086745843` on `f1e65f3`: quality, production build, API/migration/restore integration and tenant isolation passed; Vercel status check passed. Application E2E ended with 6 failures. The linked renewal now passes; risk edits persist, but the ramo-change expectation was stale (`insuredObject` is derived from the newly selected insured person); quick payment and user deletion pass. Remaining observations: WorkItem form click timeout, rendering-health strict locator, and three role/navigation checks. Logs include Prisma `P2028` on `/settings` and Next `destination stream closed early`. Do not treat the app suite as resolved.
- CI run `37081655593` on `d6c9d77`: quality and all API, build, migration, restore-integration and forced-RLS role checks passed. Application E2E failed 12 cases: scheduling a manual follow-up; ordinary WorkItem form interaction; renewal creation/follow-up closure; two structured-risk saves; quick-payment toast; rendering-health timeout; legacy renewals stats; three role-navigation assertions; and user deletion. Tenant isolation failed only because its DEMO E2E looked up a seeded client detail route that does not expose the client as expected. The test now checks the synthetic client in `/portfolio` and still checks that Pedro's private client stays hidden. Do not describe these 13 browser cases as resolved until a new exact-SHA run passes.
- CI run `37073002449`: quality passed; tenant-isolation failed because an
  integration test expected an implicit tenant filter before RLS was active;
  application E2E failed two strict policy-number-only accessible-name
  assertions after insured-object descriptions were added. The backup/restore
  integration step passed on its disposable local PostgreSQL database.
- Release-certification run `37060437543` failed tenant checks after maintenance
  was entered too early, and billing metrics expected September while its
  disposable records were created in October. The two fixes were present only
  as uncommitted changes in the shared checkout when inventoried.
- GitHub reported the Vercel check `success` on `f1e65f3`. The local `.vercel/project.json` identified project `policydesk` and the connected Vercel team, but `list_projects` returned zero and project/deployment lookup returned `INVALID_ARGUMENT`. No runtime deployment SHA has been verified through this connection.
- The earlier DEMO branches are tied to SHA `97a45cd`; they are empty and are
  not evidence for the current candidate.

## Safety and closure

- Preserve unrelated changes in the shared checkout. Keep all implementation
  work on isolated branches and integrate only reviewed paths.
- Use disposable local PostgreSQL for CI tests. Remote Neon operations require
  exact candidate SHA, explicit temporary branch identity and a drill-only key
  generated inside the approved runner; never transfer Production credentials.
- Do not run production migration, restore, tenant cutover, enable prospect
  access, or expose real customer data before the recovery evidence and target
  reconnection procedure are presented for approval.
- Record the exact candidate SHA and CI, API, browser, isolation, restore and
  Vercel evidence before marking either release result ready.
- Close with two independent results: `READY FOR DAILY USE` and
  `READY FOR EXTERNAL DEMO ACCESS`. Archive the source chats only after their
  work and blockers are represented here and the user-visible handoff is done.

## Recovery procedure to present before cutover

**Responsible:** the Insurance release coordinator coordinates the drill and
evidence; the database operator with Neon/Vercel access performs the commands;
the user approves any change that points the live application at a recovered
database.

**Target:** a newly created, empty, temporary Neon restore branch named
`restore-<full-candidate-sha>-<incident-id>` in the explicitly approved
certification project and region. Record the branch ID, database, parent, and
connection fingerprint in the release report before restore. Never target
Production or a production branch from the restore command.

1. On a failed cutover, keep the app in maintenance mode and stop/drain
   scheduled business jobs. Record the deployed SHA and incident time; preserve
   the original branch unchanged.
2. Obtain a verified, candidate-compatible backup through the approved
   operator path. Keep the Production encryption key inside its authorized
   environment; send only the encrypted archive and sanitized manifest to the
   approved runner/artifact store. This drill uses a drill-only key generated
   in that runner and synthetic CUSTOMER fixtures, never a Production key.
3. Restore by the CLI-only recovery script to the named temporary branch. The
   operator passes the direct admin URL only to migration/restore steps and the
   restricted pooled `policydesk_app` URL only to runtime-read validation.
4. Require counts, public FKs, `POSTED`/`REVERSED` payment lifecycle,
   Policy/Receipt cancellation and renewal invariants, Notification user
   references, canonical and legacy WorkItem references, sequences, application
   reads, tenant isolation and Prisma drift to pass. Keep
   `RESTORE_DRILL_APP_SMOKE=0` unless the operator separately enables the
   smoke against this disposable target. A failure keeps the app closed and
   marks the target `FAIL`; do not connect it to the live deployment.
5. Before any live reconnection, present the report, exact target branch ID,
   sanitized connection fingerprint, Vercel project/environment, release SHA
   and verification commands to the user. After approval, the operator updates
   only the authorized runtime/admin database variables to the validated
   recovered branch, deploys the reviewed application SHA, checks health,
   authenticated tenant reads/writes, isolation and jobs, and records the
   resulting deployment SHA. Preserve the prior database branch until this
   verification and the recovery window are complete.

This is a prepared failover procedure, not an automatic Production rollback.
If a multi-organization Production cutover has happened, do not reconnect the
old singleton application; restore and validate a compatible multi-org target
and obtain approval before changing the live connection.
