-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

alter table public.meeting_reminders
  add column if not exists idempotency_key text,
  add column if not exists cancelled_at timestamptz;

create unique index if not exists meeting_reminders_idempotency_uq
  on public.meeting_reminders(idempotency_key)
  where idempotency_key is not null;

alter table public.meeting_reminders
  add constraint meeting_reminders_idempotency_format_chk
  check (idempotency_key is null or idempotency_key ~ '^[0-9a-f]{64}:(activist_1|activist_2|activist_3|coordinator)$')
  not valid;

commit;
