-- 0012_tour_reports_contact_link.sql — דיווח אחרי סיור + קישור לקוח לסיור.
-- report: הדיווח המובנה (jsonb, אותם שדות כמו דוח בסיס); הגשתו מסמנת את הסיור כ"התקיים".
alter table public.tours
  add column if not exists report jsonb,
  add column if not exists reported_by integer,
  add column if not exists reported_at timestamptz;

-- לקוח שהגיע דרך סיור (נעים להכיר) — מזהה הסיור
alter table public.contacts
  add column if not exists tour_id text;
