-- migrations/0017_feedback_issue_url.sql — ⏳ ממתינה להרצה ידנית ב-SQL Editor.
-- גשר feedback_reports → GitHub Issues, כדי שסוכן הטריאז' השבועי יוכל לקרוא את
-- הדיווחים בלי לקבל את SUPABASE_SECRET_KEY (מפתח service-role שעוקף RLS —
-- אסור להעביר אותו לסביבת הריצה של הסוכן).
--
-- issue_url משמש כ-dedup: cron פותח issue רק לשורות שבהן הוא null.
-- בלי העמודה הזו, ה-cron ב-api/cron/feedback-to-issues ייכשל בגלוי (400 מ-PostgREST)
-- ולא יפתח issues כפולים.

alter table public.feedback_reports add column if not exists issue_url text;

-- אינדקס חלקי — ה-cron שואל רק "מי עוד בלי issue".
create index if not exists feedback_reports_no_issue_idx
  on public.feedback_reports(created_at)
  where issue_url is null;
