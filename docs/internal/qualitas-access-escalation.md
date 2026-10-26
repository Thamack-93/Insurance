# Quálitas portal access request

## Summary

PolicyDesk's automatic, read-only policy lookup stopped reaching the Quálitas policy form. The flow worked through October 6, 2026. Audits recorded inconclusive final responses on October 20 and entrypoint failures on October 25. The latest code classifies the entrypoint failure as a changed form, but a separate Node transport check found a Quálitas access rejection page.

This evidence does not establish whether the rejection is based on source network, rate limits, or another provider-side rule. It does not identify Vercel as the cause.

## Sanitized observations

- A manual browser session can open the public Quálitas payment portal and display its policy lookup form.
- Node `fetch` GET requests to both `https://www.qualitas.com.mx/web/qmx/pago-de-poliza` and the prior `/web/qmx/pago-de-poliza/-/user-pago/inicio` path returned HTTP 200 with a 269-byte response and no policy form.
- The response contains the text `Request Rejected`, a support identifier, and an instruction to consult the site administrator. The support identifier and response body are intentionally not retained here.
- PolicyDesk production telemetry for the October 25 entrypoint check recorded HTTP 200 and no policy form. The current classification was `FLOW_CHANGED`; the application is being corrected to report `ACCESS_REJECTED` without parsing or logging the response body.
- The last audited successful sends were October 6. The first uncertain final responses were recorded on October 20, before the October 22 Next.js update from 16.3.8 to 16.4.2. On October 25, commit `f99618df` changed the initial path to the canonical public route, and commit `72171674` added support for the AJAX form's multipart policy lookup. The current Node check rejects both the new and prior initial paths before any form serialization occurs, so these changes do not reproduce the current entrypoint rejection.
- Source comparison shows that the successful-era and current code use explicit same-host redirects and a session cookie jar. The successful-era native form lookup was URL-encoded; the current implementation keeps that encoding for native forms and uses multipart only for the newer AJAX component. Isolated tests cover cookies, redirects, and both form encodings. Vercel currently reports Node 24.x, but historical Node-version change records were not available during this review.

## Request to Quálitas

Please correlate the rejection/support identifier from the provider's records and advise:

1. Whether automated server-side GET requests to the public policy-lookup page are permitted.
2. Whether the source network used by the integration is blocked, rate-limited, or otherwise restricted, and what evidence you need to authorize it.
3. Whether Quálitas provides an official server-to-server API or other supported integration for read-only policy/receipt lookup and payment-link requests.
4. Whether the public form flow, required headers, session behavior, or supported request serialization changed around October 20–25, 2026.

PolicyDesk will not retry uncertain final payment-link submissions or attempt to evade an access control. A rejected request must be correlated by Quálitas before another live delivery test.
