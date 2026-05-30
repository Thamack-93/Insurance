# API authentication matrix

All routes under `src/app/api/` require a valid session cookie (`pd_session`) unless listed as public.

| Route | Method | Auth | Role |
|-------|--------|------|------|
| `/api/auth/logout` | POST | Public | — |
| `/api/jobs/backup` | POST | Bearer `BACKUP_JOB_SECRET` | Cron job |
| `/api/integrations/telegram/webhook` | GET / POST | Public for Telegram webhook | Telegram secret header on POST |
| `/api/search` | GET | Session | Any active user |
| `/api/payments/quick` | POST | Session | Any active user |
| `/api/commissions/stats` | GET | Session | Any active user |
| `/api/commissions/[id]/status` | POST | Session | Any active user |
| `/api/documents/upload` | POST | Session | Any active user |
| `/api/documents/[id]/download` | GET | Session | Any active user |
| `/api/backups/[filename]/download` | GET | Session | Admin only |

Dashboard pages are protected by `src/proxy.ts` (redirect to `/login`) and re-validated in `src/app/(dashboard)/layout.tsx`.
