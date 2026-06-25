-- 0004_payment_config.sql — טבלת קונפיג מרכזית לתעריפי/יעדי/בונוסי שכר (No-Hard-Coding).
-- שורה יחידה (id=1). ניתן לשנות ערכים ישירות ב-DB בלי דיפלוי. הורץ דרך ה-SQL Editor 2026-06-25.
create table if not exists public.payment_config (
  id int primary key default 1,
  rate_frontal_friendly int not null default 250,
  rate_frontal_torani   int not null default 300,
  rate_phone_torani     int not null default 200,
  rate_phone_friendly   int not null default 150,
  rate_video_torani     int not null default 250,
  rate_multi            int not null default 300,
  cap_frontal int not null default 15,
  cap_phone   int not null default 25,
  cap_multi   int not null default 6,
  cap_contact_frontal_regular int not null default 2,
  cap_contact_phone_regular   int not null default 4,
  cap_contact_frontal_high    int not null default 6,
  cap_contact_phone_high      int not null default 10,
  bonus_loyalty_4 int not null default 600,
  bonus_loyalty_6 int not null default 850,
  bonus_mitzvot_level   int not null default 600,
  bonus_new_participant int not null default 250,
  min_duration_minutes  int not null default 15,
  cap_exceed_blocks boolean not null default false, -- false=התרעה בלבד, true=חסימת דיווח בחריגה
  constraint payment_config_single_row check (id = 1)
);
insert into public.payment_config (id) values (1) on conflict (id) do nothing;
alter table public.payment_config enable row level security;
drop policy if exists authenticated_read on public.payment_config;
create policy authenticated_read on public.payment_config for select to authenticated using (true);
