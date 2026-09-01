// lib/paymentConfig.js — טוען את תעריפי/יעדי/בונוסי השכר מטבלת Supabase `payment_config`.
// No-Hard-Coding: כל הערכים ניתנים לשינוי ב-DB בלי דיפלוי. DEFAULT_CONFIG = fallback בטוח
// (זהה לערכים שהארגון אישר) למקרה שהטעינה נכשלת או לפני שהיא הושלמה.
import { getSupabaseClient } from './supabaseClient';

// ברירת מחדל — בדיוק הערכים המאושרים. גם המבנה שמנוע התשלום (paymentCalc) מצפה לו.
export const DEFAULT_CONFIG = {
  BASE_PRICES: {
    'טלפוני-ידידותי':      0,
    'טלפוני-תורני':        150,
    'וידאו-תורני':         200,
    'וידאו-ידידותי':       200,
    'פרונטלי-ידידותי':     250,
    'פרונטלי-תורני':       300,
    'פרונטלי-רב משתתפים': 300,
    'אירוח שבת':           600,
  },
  MONTHLY_CAPS:     { phone: 25, frontal: 15, multi: 6 },
  // regular.phone = 10 — החלטת נדב 2026-07-26: כל לקוח נחשב פוטנציאלי.
  PER_CONTACT_CAPS: { high: { frontal: 6, phone: 10 }, regular: { frontal: 6, phone: 10 } },
  LEARNING_BONUS:   { 4: 600, 6: 850 },
  MITZVOT_BONUS_PER_LEVEL: 600,
  NEW_PARTICIPANT_BONUS:   250,
  MIN_DURATION:     15,
  CAP_EXCEED_BLOCKS: false,
  TOUR_GUIDE_RATE:  750, // שכר מדריך סיור (נעים להכיר) — כשהמדריך הוא פעיל שלנו
};

// ממיר שורת DB ל-shape שמנוע התשלום והדשבורד צורכים.
function rowToConfig(r) {
  if (!r) return DEFAULT_CONFIG;
  return {
    BASE_PRICES: {
      'טלפוני-ידידותי':      r.rate_phone_friendly,
      'טלפוני-תורני':        r.rate_phone_torani,
      'וידאו-תורני':         r.rate_video_torani,
      // fallback ל-200 אם המיגרציה (0005) טרם הורצה בסביבה זו והעמודה חסרה
      'וידאו-ידידותי':       r.rate_video_friendly ?? 200,
      'פרונטלי-ידידותי':     r.rate_frontal_friendly,
      'פרונטלי-תורני':       r.rate_frontal_torani,
      'פרונטלי-רב משתתפים': r.rate_multi,
      // fallback ל-600 אם המיגרציה (0008) טרם הורצה והעמודה חסרה
      'אירוח שבת':           r.rate_shabbat_hosting ?? 600,
    },
    MONTHLY_CAPS:     { phone: r.cap_phone, frontal: r.cap_frontal, multi: r.cap_multi },
    PER_CONTACT_CAPS: {
      high:    { frontal: r.cap_contact_frontal_high,    phone: r.cap_contact_phone_high },
      regular: { frontal: r.cap_contact_frontal_regular, phone: r.cap_contact_phone_regular },
    },
    LEARNING_BONUS:          { 4: r.bonus_loyalty_4, 6: r.bonus_loyalty_6 },
    MITZVOT_BONUS_PER_LEVEL: r.bonus_mitzvot_level,
    NEW_PARTICIPANT_BONUS:   r.bonus_new_participant,
    MIN_DURATION:            r.min_duration_minutes,
    CAP_EXCEED_BLOCKS:       r.cap_exceed_blocks,
    // fallback ל-750 אם המיגרציה (0010) טרם הורצה והעמודה חסרה
    TOUR_GUIDE_RATE:         r.rate_tour_guide ?? 750,
  };
}

// טוען את הקונפיג מ-Supabase. מחזיר DEFAULT_CONFIG בכשל (לעולם לא זורק).
export async function loadPaymentConfig() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('payment_config').select('*').eq('id', 1).single();
    if (error || !data) return DEFAULT_CONFIG;
    return rowToConfig(data);
  } catch (err) {
    console.warn('loadPaymentConfig failed, using defaults', err);
    return DEFAULT_CONFIG;
  }
}
