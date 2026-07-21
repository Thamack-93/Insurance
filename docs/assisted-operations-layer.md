# Assisted Operations Layer

PolicyDesk has an assisted-operations layer on top of the live Postgres CRM. Chat state stays
in memory in the browser and is never written to localStorage, sessionStorage or the database.

## Current Status

- `WorkItem` remains the unified operational queue.
- `Task`, `Alert`, and `Reminder` remain legacy-only and are not used for new operational logic.
- Notification persistence is live in Postgres through:
  - `NotificationChannel`
  - `NotificationPreference`
  - `NotificationEvent`
- Telegram linking, deterministic commands and daily digests are available.
- The digest cron runs hourly and evaluates each user's `timeZone` and `telegramDigestHour`.
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
  - timezone and digest hour
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
- Telegram linking uses one-time codes stored as hashes with expiry.
- Telegram test messages use the live bot token and update `NotificationEvent` status.
- The digest contains overdue/today/upcoming receipts, renewals, overdue work and commissions.
- Webhook synchronization is an explicit admin action; opening settings has no external side effect.
- Telegram remains deterministic. Freeform AI replies are intentionally not enabled there.

### Nora AI

- Normal replies use the configured MiniMax model with gateway fallback.
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

- No local conversation history is stored.
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
