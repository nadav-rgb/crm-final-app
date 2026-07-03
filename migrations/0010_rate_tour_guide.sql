-- 0010_rate_tour_guide.sql — שכר מדריך סיור ("נעים להכיר"): 750 ₪ לסיור.
-- משולם כשהמדריך הוא פעיל שלנו (החלטת נדב 2026-07-03). נצרך ע"י מודול הסיורים (שלב 3).
alter table public.payment_config
  add column if not exists rate_tour_guide integer not null default 750;
