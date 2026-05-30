# Assisted Operations Layer

PolicyDesk now has a first-pass notification foundation on top of the live Postgres CRM.
This document captures what was implemented in the current sprint and what is still deferred.

## Current Status

- `WorkItem` remains the unified operational queue.
- `Task`, `Alert`, and `Reminder` remain legacy-only and are not used for new operational logic.
- Notification persistence is live in Postgres through:
  - `NotificationChannel`
  - `NotificationPreference`
  - `NotificationEvent`
- Telegram linking and the basic webhook flow are now available.
- The settings UI can generate a link code, send a test message, and disconnect Telegram.
- The AI assistant and AI write actions are still deferred to future phases.

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

- `/settings/notifications` lets each authenticated user view:
  - Telegram connection status
  - their preference rows
  - quiet hours
  - minimum priority thresholds
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

### Seeds / validation

- Default notification rows are seeded for users in the demo seed path.
- A logic test suite covers:
  - priority thresholds
  - quiet hours detection
  - event catalog defaults

## What Is Not Built Yet

- The web AI assistant on `/assistant`.
- AI write actions.

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

### Future sprint variables

- AI model routing / gateway variables for the assistant sprint

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

## Next Sprint

- Telegram digest automation and richer outbound notification routing.
- Read-only web AI assistant.
- Limited AI write actions for `WorkItem` only.
