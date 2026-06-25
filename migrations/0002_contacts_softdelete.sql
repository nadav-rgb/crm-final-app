-- 0002_contacts_softdelete.sql — soft-delete ללקוחות (F1). הורץ דרך ה-SQL Editor 2026-06-25.
alter table public.contacts add column if not exists is_active boolean not null default true;
