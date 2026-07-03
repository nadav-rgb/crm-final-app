-- 0009_profiles_project_ids.sql — תמיכה בפעיל בכמה פרויקטים ("נעים להכיר" project_id=2).
-- profiles.project_id (יחיד) נשאר לתאימות-לאחור = הפרויקט הראשי;
-- project_ids = כל הפרויקטים שהמשתמש חבר בהם.
alter table public.profiles
  add column if not exists project_ids integer[];

update public.profiles
   set project_ids = array[project_id]
 where project_ids is null
   and project_id is not null;
