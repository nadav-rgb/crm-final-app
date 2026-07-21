-- migrations/0016_feedback_reports.sql
-- עמוד "תקלות והצעות": כל פעיל יכול לדווח על באג/תקיעה/הצעת שיפור. הרכזים/מנכ"ל סוקרים
-- ומעדכנים סטטוס (open → reviewed). מבודד לפי project_id כמו שאר הטבלאות הרגישות (0013).

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id int not null,
  reporter_name text,
  project_id int,
  category text not null default 'suggestion', -- bug | stuck | suggestion
  message text not null,
  status text not null default 'open', -- open | reviewed
  reviewer_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists feedback_reports_project_idx on public.feedback_reports(project_id, created_at desc);
create index if not exists feedback_reports_reporter_idx on public.feedback_reports(reporter_id, created_at desc);

alter table public.feedback_reports enable row level security;

drop policy if exists feedback_reports_select on public.feedback_reports;
drop policy if exists feedback_reports_insert on public.feedback_reports;
drop policy if exists feedback_reports_update on public.feedback_reports;

create policy feedback_reports_select on public.feedback_reports for select to authenticated using (
  app_current_role() = 'ceo'
  or reporter_id = app_current_activist_code()
  or (app_current_role() in ('coord','head','finance') and project_id = any(app_current_project_ids()))
);

create policy feedback_reports_insert on public.feedback_reports for insert to authenticated with check (
  reporter_id = app_current_activist_code()
);

-- עדכון (סטטוס/הערת סוקר) — רק בעלי תפקיד ניהולי, לא המדווח עצמו.
create policy feedback_reports_update on public.feedback_reports for update to authenticated using (
  app_current_role() = 'ceo'
  or (app_current_role() in ('coord','head') and project_id = any(app_current_project_ids()))
);
