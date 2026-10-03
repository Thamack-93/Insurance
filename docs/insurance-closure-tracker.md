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
| Structured risk fields for all ten policy lines and conservative conversion | Coordinator + policy workstream | Migration and conversion pass on disposable PostgreSQL; dry-run and approved per-organization report; source text retained; ambiguous records marked for review; reruns do not duplicate data; PR checks green | Local review fixes implemented for legacy text preservation, relation replacement and beneficiary editing. On `038777e` the DB assertions show both edit forms did not save: the unrelated edit left Notes null; ramo change left AUTO and prior relations intact. New E2E instrumentation will capture the underlying Server Action response. |
| Renewal follow-ups and Operation controls | Policy/renewal workstream | Create/link renewal closes manual and automatic follow-ups in the same transaction; reprogram/remove manual follow-up; ordinary tasks edit/cancel with original identity and authorization; focused database and browser coverage | Implemented in isolated commit `d52b0d1`; 33 unit tests, TypeScript and lint passed. On `038777e`, new policy submission left the source ACTIVE and both follow-ups OPEN. Ordinary WorkItem E2E still could not locate the status selector using role `combobox`; the next run uses its associated label and captures the server action response. |
| Operational Insights | Insights workstream | `/reports/insights` provides four signal groups, grouped actionable records, current action links, group filters, 25-item pages, required organization/portfolio scope, business dates and resolved-signal disappearance; focused tenant and UI tests pass | Implemented in isolated commit `9e63aec`; typecheck, 30 focused tests, lint, navigation check and diff-check passed; full application E2E remains under repair |
| CI and certification workflow | CI workstream | Disposable tenant, application, API/E2E and restore gates pass on exact candidate SHA; maintenance begins only immediately before RLS cutover; date-sensitive billing test follows the actual test month | Exact candidate `038777e` / run `37085287170`: quality, build/API/migration/restore integration and full tenant isolation passed; Vercel status check passed. App E2E still failed the same 9 cases (43 passed, 15 skipped). Toast assertions were removed and the failures now prove renewal/risk/payment mutations did not persist; action response capture is being added to expose why. Role navigation and user deletion remain unresolved. |
| DEMO safeguards and private readiness | Coordinator | Synthetic-only seed/documents, server-side DEMO restrictions, exact-SHA two-organization isolation/API/browser proof, reset/revocation proof, first normal job cycle and approved prospect access controls | Not ready: exact-SHA tenant isolation passed on `038777e`, including synthetic-client access from `/portfolio` and invisibility of Pedro's private client. Reset/revocation, multi-org production cutover and prospect access remain unverified and approval-gated. |
| Backup/restore and cutover recovery | Coordinator | Exact-SHA temporary source/restore branches; verified synthetic CUSTOMER backup containing risk fields/assets/parties/source text; required count/FK/lifecycle/reference/sequence/application-read/drift checks all pass; `RESTORE_DRILL_APP_SMOKE=0`; documented human-approved target reconnection | Not ready: no SHA-matched Neon drill. Existing disposable GitHub Actions backup/restore integration passed on `d6c9d77`; this is not remote Neon certification |
| Vercel identity and deployment | Coordinator | Commit author maps to the verified GitHub account; authorized project access; Vercel deployment and runtime URL show the exact published SHA and authenticated paths work | GitHub reports the Vercel check `success` on `d6c9d77`; this verifies the check only. The Vercel connector still cannot list project details (0 projects / HTTP 403), so the deployed runtime SHA and authenticated browser paths remain unverified |

## Checkpoints already collected

- `main` at inventory time: `d1a9a60368fe94826bffafd0ec3e5e7709800438`.
- PR #73: base `d1a9a60368fe94826bffafd0ec3e5e7709800438`, head
  `66c6f25c34e92a2065d4920560414c26be22bbcd`, open and mergeable.
- Current remote PR candidate at this checkpoint: `038777efcf0a56b65a8a11fdf1197f50ffb287d4`; PR #73 remains open and unmerged.
- CI run `37085287170` on `038777e`: quality, production build, API/migration/restore integration and tenant isolation passed; Vercel status check passed. Application E2E still failed 9 cases (43 passed, 15 skipped). The renewal test observed source ACTIVE and both follow-ups OPEN; the risk tests observed no saved edits; the quick-payment dialog remained open. The task status selector remained inaccessible to the chosen role locator. Three role navigation tests and user deletion also failed. E2E Server Action response capture is added to the next candidate to pinpoint failed form submissions. User deletion still removes the list row while the database user remains. Do not treat the app suite as resolved.
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
- GitHub reported the Vercel check `success` on `038777e`. The local `.vercel/project.json` identified project `policydesk` and the connected Vercel team, but `list_projects` returned zero and project/deployment lookup returned `INVALID_ARGUMENT`. No runtime deployment SHA has been verified through this connection.
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
