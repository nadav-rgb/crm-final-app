-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

alter table public.tours
  add column if not exists reported_by_user_id uuid references auth.users(id),
  add column if not exists cancellation_reason text;

alter table public.tours
  add constraint tours_status_security_chk check (status in ('upcoming','completed','cancelled')) not valid,
  add constraint tours_cancellation_reason_len_chk check (cancellation_reason is null or length(cancellation_reason) <= 200) not valid;

create index if not exists tours_reported_by_user_idx on public.tours(reported_by_user_id);

commit;
