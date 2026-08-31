# Assisted Operations Layer

PolicyDesk has an assisted-operations layer on top of the live Postgres CRM. Nora keeps a bounded,
versioned session handoff in `sessionStorage`, scoped to the authenticated user and browser tab.
It expires automatically and is removed on logout; it is never written to the database.

## Current Status

- `WorkItem` remains the unified operational queue.
- `Task`, `Alert`, and `Reminder` remain legacy-only and are not used for new operational logic.
- Notification persistence is live in Postgres through:
  - `NotificationChannel`
  - `NotificationPreference`
  - `NotificationEvent`
- Telegram linking, deterministic commands and daily digests are available.
- The digest cron runs once daily at 14:00 UTC (08:00, Mexico City time). Individual digest hours
  are temporarily disabled, while duplicate protection still uses each user's local date.
- Nora has deterministic answers plus AI fallback, structured action proposals and PDF review.
- AI status distinguishes configured from verified; admins can test the gateway at
  `/api/admin/assistant/health`.

## Implemented This Sprint

### Notification foundation

- `NotificationChannel` supports user-scoped channels with `TELEGRAM` as the initial channel type.
- `NotificationPreference` supports:
  - `eventType`
  - `channelType`
  - `enabled`
  - `minPriority`
  - optional quiet hours (`quietHoursStart`, `quietHoursEnd`)
- `NotificationEvent` supports durable event tracking with:
  - `type`
  - `title`
  - `body`
  - `priority`
  - `userId`
  - optional `workItemId`, `clientId`, `policyId`, `receiptId`
  - `channelType`
  - `status` (`PENDING`, `SENT`, `FAILED`, `SKIPPED`)
  - `sentAt`
  - `error`
- Helpers were added for:
  - creating notification events
  - reading preferences
  - evaluating whether a user should be notified
  - marking events sent / failed / skipped
- Preference changes write to `ActivityLog`.

### Settings UI

- `/settings/notifications` lets each authenticated user view and update:
  - Telegram connection status
  - their preference rows
  - delivery preferences
  - timezone (the individual digest hour is temporarily fixed)
  - test, send now and disconnect controls
- A link card was added from `/settings`.
- Users can generate a temporary Telegram link code and send a test message once linked.

### Telegram MVP

- Telegram webhook handling is available at:
  - `/api/integrations/telegram/webhook`
- Supported commands:
  - `/start`
  - `/help`
  - `/link <código>`
  - `/status`
  - `/pagoqualitas <póliza>`
- Telegram linking uses one-time codes stored as hashes with expiry.
- Telegram test messages use the live bot token and update `NotificationEvent` status.
- The digest contains overdue/today/upcoming receipts, renewals, overdue work and commissions.
- Webhook synchronization is an explicit admin action; opening settings has no external side effect.
- Telegram remains deterministic. Freeform AI replies are intentionally not enabled there.
- `/pagoqualitas` is an insurer-specific Quálitas payment-link request. It resolves an
  authorized PolicyDesk policy, requires explicit `/confirmar`, and accepts only the
  profile destinations shown by the flow. Agent WhatsApp prefers `User.phone`; if absent,
  the Agent may capture a one-request manual number that is normalized, masked and never
  saved to the profile or activity log.
- Recipient buttons are inline Telegram buttons, with `cliente`/`agente` text as fallback.
  The request is protected by `telegramMutationsEnabled`, `QUALITAS_PAYMENT_LINK_ENABLED`,
  tenant/portfolio authorization, confirmation-time revalidation and rate limiting. Client
  delivery is separately disabled by default via `QUALITAS_PAYMENT_LINK_CLIENT_RECIPIENT_ENABLED`
  until the Agent pilots pass.
- Provider failures are sanitized. A final timeout is `UNCERTAIN` and is not retried
  automatically. PolicyDesk never handles card data or stores payment URLs by default.
- This integration depends on Quálitas' current public workflow and has a kill switch in
  `QUALITAS_PAYMENT_LINK_ENABLED`; website changes require a new discovery review.

### Nora AI

- Normal replies use Qwen 3.7 Flash with ordered DeepSeek V4 Flash 0731 and GPT-5.4 Nano fallbacks.
- Simple reads execute one tenant-authorized local capability before the model writes the response;
  complex agent reads retain the bounded tool loop and never start a third model after the two
  agent attempts are exhausted.
- Action proposals use `AI_GATEWAY_STRUCTURED_MODEL` and strict schemas where every property is
  required; nullable values are `null` and empty collections are `[]`.
- Gateway failures are mapped to actionable codes such as `rate_limited`, `budget_exceeded`,
  `provider_unavailable` and `invalid_output`.
- PDF extraction/review remains human-confirmed and does not save changes automatically.

### Seeds / validation

- Default notification rows are seeded for users in the demo seed path.
- A logic test suite covers:
  - priority thresholds
  - quiet hours detection
  - event catalog defaults

## Deliberate boundaries

- Nora does not keep a durable conversation history. The browser may retain up to 20 sanitized
  text messages for 30 minutes to preserve a panel-to-workspace handoff. Diagnostic traces,
  provider payloads, auth data, PDF bytes, report rows and pending mutation drafts are excluded.
- Policy capture handoffs are user-scoped, expire after 15 minutes and are consumed once when the
  capture screen opens. Logout clears both current and legacy browser keys.
- `NEXT_PUBLIC_NORA_SESSION_PERSISTENCE=false` is an emergency rollback switch. Nora falls back to
  in-memory state for the current tab without changing database or provider behavior.
- Telegram does not interpret freeform AI commands.
- AI never directly writes a client, policy, receipt, payment or task without the existing
  confirmation flow.

## Environment Variables

### Already required by the app

- `DATABASE_URL`
- Existing auth/session settings already used by PolicyDesk

### Telegram variables

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `APP_BASE_URL`

### Telegram setup

- Register the webhook once with Telegram using the public app URL and the same secret token:
  - `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook`
  - `url=<APP_BASE_URL>/api/integrations/telegram/webhook`
  - `secret_token=<TELEGRAM_WEBHOOK_SECRET>`

### AI variables

- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_FALLBACK_MODELS`
- `AI_GATEWAY_STRUCTURED_MODEL`
- `AI_GATEWAY_STRUCTURED_FALLBACK_MODELS`
- `AI_GATEWAY_API_KEY` or Vercel OIDC

## Manual Test Checklist

- Open `/settings` and verify the new Notifications card is visible.
- Open `/settings/notifications`.
- Generate a Telegram link code and confirm it appears on screen.
- Use `/link <code>` in Telegram and confirm the channel switches to connected.
- Send a Telegram test message and confirm a `NotificationEvent` is written.
- Change a preference row and save.
- Confirm the page refreshes without error.
- Confirm `ActivityLog` records the preference change.
- Confirm `npm run db:check-drift` stays clean after the migration.

## Verification checklist

- `npm run db:generate && npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- Open `/assistant` at desktop and mobile widths; confirm the chat uses the available width,
  today metrics are coherent, technical traces are collapsed and retry does not restore history.
- Open `/settings/assistant` and use `Probar conexión` as an admin.
- Open `/settings/notifications`, change the digest hour, toggle a preference and send a test.
