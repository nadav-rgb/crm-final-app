-- 0011_tours.sql — סיורים ("נעים להכיר", project_id=2). מקביל לבתי מפגש אבל אירוע חד-פעמי.
-- מדריך: טקסט חופשי או פעיל שלנו (guide_activist_id). משפחה מארחת: תמיד פעיל (host_activist_id).
create table if not exists public.tours (
  id                 text primary key,
  tour_number        text not null,
  settlement         text not null,
  date               date,
  start_time         text,
  guide_name         text not null default '',
  guide_activist_id  integer,          -- מולא => המדריך הוא פעיל שלנו (זכאי לשכר מדריך)
  host_activist_id   integer,          -- המשפחה המארחת — תמיד פעיל שלנו
  assigned_activists integer[] not null default '{}',
  status             text not null default 'upcoming',  -- upcoming | completed
  notes              text,
  project_id         integer not null default 2,
  created_at         timestamptz not null default now()
);

alter table public.tours enable row level security;

-- קריאה לכל משתמש מחובר; כתיבה רק דרך ה-API (service role, כמו meeting_houses)
drop policy if exists "tours_select_authenticated" on public.tours;
create policy "tours_select_authenticated" on public.tours
  for select to authenticated using (true);
