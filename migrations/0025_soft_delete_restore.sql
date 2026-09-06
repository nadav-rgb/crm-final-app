-- migrations/0025_soft_delete_restore.sql
-- מחיקה-רכה + שחזור (90 יום) לפעילים ולקוחות, בהרשאת רכז/ראש-פרויקט (2026-09-06).
--
-- profiles: אין להם היום שום עמודת סטטוס בכלל (הטבלה קדמה לתיקיית המיגרציות).
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists deleted_at timestamptz null;

-- contacts: is_active כבר קיים (0002_contacts_softdelete.sql). מוסיפים deleted_at
-- (לחישוב חלון-90-יום) ו-deleted_via_activist_id (מסמן "נמחק כתוצאת-לוואי של מחיקת
-- הפעיל X" — קריטי לשחזור מדויק: שחזור פעיל משחזר *רק* לקוחות עם הסימון הזה שווה
-- למזהה שלו, לא לקוחות שהפעיל מחק בעצמו בנפרד, לפני או אחרי).
alter table public.contacts add column if not exists deleted_at timestamptz null;
alter table public.contacts add column if not exists deleted_via_activist_id integer null;

-- ⚠️ activist_directory (view) לא מעודכן כאן במכוון — ראה הערת ⚠️ בראש התוכנית.
-- לאחר שמישהו מריץ `select pg_get_viewdef('public.activist_directory'::regclass, true);`
-- ומספק את התוצאה, יתווסף כאן (או במיגרציה נפרדת) `create or replace view` שחושף גם
-- is_active וגם deleted_at, ומסנן is_active=true כברירת מחדל.
