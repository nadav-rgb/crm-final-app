-- 0008_rate_shabbat.sql — תעריף "אירוח שבת" (600 ₪) ב-payment_config, DB-editable.
-- הקוד עובד גם בלי העמודה (fallback 600 ב-paymentConfig.js).
alter table public.payment_config
  add column if not exists rate_shabbat_hosting integer not null default 600;
