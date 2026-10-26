# Quálitas portal access request

## Summary

PolicyDesk's automatic, read-only policy lookup stopped reaching the Quálitas policy form. The flow worked through October 6, 2026. Audits recorded inconclusive final responses on October 20 and entrypoint failures on October 25.

The correction is deployed in production as of October 26, 2026. It identifies Quálitas's `Request Rejected` response as `ACCESS_REJECTED`, stops the lookup, and avoids treating the rejection page as a changed form. A production lookup on October 26 at 02:54:11 UTC received that rejection. The manual portal remained accessible in the browser.

This evidence does not establish whether the rejection is based on source network, rate limits, or another provider-side rule. It does not identify Vercel as the cause.

## Sanitized observations

- A manual browser session can open the public Quálitas payment portal and display the policy lookup result.
- Node `fetch` GET requests to both `https://www.qualitas.com.mx/web/qmx/pago-de-poliza` and the prior `/web/qmx/pago-de-poliza/-/user-pago/inicio` path returned HTTP 200 with a 269-byte response and no policy form.
- The response contains the text `Request Rejected`, a support identifier, and an instruction to consult the site administrator. The support identifier and response body are intentionally not retained here.
- The October 26 production check returned `ACCESS_REJECTED` from the read-only server lookup. It added one activity audit observation; the receipt remained `PENDING` for MXN 6,890.09, its local due date remained October 28, and no Payment row was created.
- In the manual portal, the same receipt was shown as payable for MXN 6,890.09 with an October 14, 2026 due date. The difference from the local October 28 date remains pending review. Neither date nor the receipt amount or status was changed.
- The last audited successful sends were October 6. The first uncertain final responses were recorded on October 20, before the October 22 Next.js update from 16.3.8 to 16.4.2. On October 25, commit `f99618df` changed the initial path to the canonical public route, and commit `72171674` added support for the AJAX form's multipart policy lookup. The isolated Node check rejects both the new and prior initial paths before any form serialization occurs, so those changes do not reproduce the current entrypoint rejection.
- Source comparison shows that the successful-era and current code use explicit same-host redirects and a session cookie jar. The successful-era native form lookup was URL-encoded; the current implementation keeps that encoding for native forms and uses multipart only for the newer AJAX component. Isolated tests cover cookies, redirects, both form encodings, HTTP 200 rejection pages, changed forms, and rejection after final submission. Vercel currently reports Node 24.x, but historical Node-version change records were not available during this review.

The production fix logs only HTTP status, lookup step, redirect count, response size, and sanitized rejection classification. It does not log HTML, cookies, tokens, or the support identifier.

## Request to Quálitas

Please correlate the rejected request from October 26 at 02:54:11 UTC and advise:

1. Whether automated server-side GET requests to the public policy-lookup page are permitted.
2. Whether the source network used by the integration is blocked, rate-limited, or otherwise restricted, and what evidence you need to authorize it.
3. Whether Quálitas provides an official server-to-server API or other supported integration for read-only policy/receipt lookup and payment-link requests.
4. Whether the public form flow, required headers, session behavior, or supported request serialization changed around October 20–25, 2026.

PolicyDesk will not retry uncertain final payment-link submissions or attempt to evade an access control. A rejected request must be correlated by Quálitas before another live delivery test. The policy and receipt identifiers can be provided through Quálitas's authenticated support channel.
