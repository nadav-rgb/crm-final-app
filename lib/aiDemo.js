// lib/aiDemo.js
// שכבת AI דמו חכמה בלבד: אין קריאה לשרת, אין API, ואין עלויות.
// המטרה היא להראות לארגון איך סיכום AI עתידי ייראה ויתנהג,
// עם ניתוח מובנה לפי שדות עבודה של הרכז.

function safeText(text) {
  return String(text || '').trim();
}

function normalize(text) {
  return safeText(text).toLowerCase();
}

function hasWord(text, words) {
  const normalized = normalize(text);
  return words.some(word => normalized.includes(word));
}

function countSignals(text, groups) {
  return groups.reduce((sum, group) => sum + (hasWord(text, group.words) ? group.score : 0), 0);
}

function pickRelationshipStatus(text) {
  const score = countSignals(text, [
    { words: ['אמון', 'פתיחות', 'נפתח', 'שיתף', 'חיבור', 'קרוב', 'טוב', 'רציני'], score: 2 },
    { words: ['התעניין', 'שאל', 'רוצה', 'המשך', 'להיפגש', 'פגישה'], score: 1 },
    { words: ['סירב', 'קר', 'התנגד', 'לא מעוניין', 'קשה', 'חשש'], score: -2 },
  ]);

  if (score >= 3) return 'חם מאוד: ניכר שנבנה אמון ויש פוטנציאל גבוה להמשך קשר אישי.';
  if (score >= 1) return 'חיובי: יש בסיס להמשך, אך כדאי להגדיר פעולה הבאה ברורה.';
  if (score <= -1) return 'רגיש: יש סימני הסתייגות או קושי, מומלץ להתקדם בעדינות.';
  return 'ראשוני: הקשר תועד, אך עדיין לא זוהתה רמת עומק מספקת בדמו.';
}

function pickSpiritualProgress(text) {
  const areas = [];
  if (hasWord(text, ['שבת', 'קידוש', 'נרות', 'סעודה'])) areas.push('שבת');
  if (hasWord(text, ['תפילה', 'בית כנסת', 'מניין', 'סידור'])) areas.push('תפילה');
  if (hasWord(text, ['כשרות', 'כשר', 'מטבח', 'בשר', 'חלב'])) areas.push('כשרות');
  if (hasWord(text, ['לימוד', 'שיעור', 'חברותא', 'ספר', 'תורה'])) areas.push('לימוד תורה');
  if (hasWord(text, ['מצווה', 'מצוות', 'ציצית', 'תפילין', 'מזוזה'])) areas.push('מצוות מעשיות');

  if (areas.length === 0) {
    return 'לא זוהתה התקדמות רוחנית מובהקת מתוך הטקסט. מומלץ לתעד בפעם הבאה אם עלה נושא של שבת, תפילה, כשרות, לימוד או מצווה מעשית.';
  }

  return `זוהתה נגיעה בתחומים: ${areas.join(', ')}. מומלץ לעקוב האם מדובר בהתעניינות כללית או התחייבות מעשית.`;
}

function pickNextAction(text) {
  if (hasWord(text, ['לקבוע', 'נקבע', 'פגישה', 'להיפגש', 'שבוע הבא', 'מחר'])) {
    return 'לקבע ביומן את ההמשך ולוודא שהפעולה הבאה מתועדת עם תאריך.';
  }
  if (hasWord(text, ['שאל', 'שאלה', 'מתלבט', 'רוצה להבין'])) {
    return 'לחזור אליו עם תשובה ממוקדת או חומר קצר שממשיך את השאלה שעלתה.';
  }
  if (hasWord(text, ['שבת', 'סעודה', 'אירוח'])) {
    return 'לבדוק התאמה להזמנה לשבת או למפגש המשך סביב חוויה משפחתית/קהילתית.';
  }
  return 'להגדיר המשך ברור: שיחה, פגישה, הזמנה או שליחת חומר מתאים.';
}

function pickCoordinatorFlags(text) {
  const flags = [];
  if (hasWord(text, ['מתלבט', 'קושי', 'חשש', 'משפחה', 'רגיש'])) flags.push('נושא רגיש: כדאי שרכז יעבור על הדיווח לפני המשך פעולה.');
  if (hasWord(text, ['מאוד רוצה', 'רציני', 'התחייב', 'מוכן', 'התקדם'])) flags.push('פוטנציאל גבוה: מומלץ לתת עדיפות למעקב קרוב.');
  if (hasWord(text, ['לא ענה', 'ביטל', 'דחה', 'לא מעוניין'])) flags.push('סיכון נשירה: כדאי להחליט האם להמשיך בעדינות או להשהות.');
  if (flags.length === 0) flags.push('אין דגל חריג בדמו, אך מומלץ לוודא שיש פעולה הבאה ברורה.');
  return flags;
}

function buildStructuredSummary({ title, text, contextLine }) {
  const value = safeText(text);
  if (!value) return '';

  const flags = pickCoordinatorFlags(value);

  return [
    `${title}:`,
    contextLine ? `• הקשר: ${contextLine}` : null,
    `• נקודות מרכזיות: ${extractMainPoints(value).join(' | ')}`,
    `• מצב הקשר: ${pickRelationshipStatus(value)}`,
    `• התקדמות רוחנית: ${pickSpiritualProgress(value)}`,
    `• פעולה מומלצת: ${pickNextAction(value)}`,
    `• דגלים לרכז: ${flags.join(' ')}`,
    '• הערה: זהו ניתוח דמו לפי מילות מפתח בלבד. בשלב עתידי יוחלף ב־AI אמיתי לפי הדגשים שתגדירו.'
  ].filter(Boolean).join('\n');
}

function extractMainPoints(text) {
  const value = safeText(text).replace(/\s+/g, ' ');
  const sentences = value.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean);
  const picked = sentences.slice(0, 2);

  if (picked.length >= 2) return picked;
  if (picked.length === 1) return [picked[0], 'נדרש המשך תיעוד כדי לדייק את תמונת המצב'];
  return ['תועד מפגש במערכת', 'נדרש המשך מעקב'];
}

export function summarizeInteractionDemo(text, meta = {}) {
  const contactName = meta.contactName ? `לקוח: ${meta.contactName}` : '';
  const interactionType = meta.type ? `סוג קשר: ${meta.type}` : '';
  const quality = meta.quality ? `איכות: ${meta.quality}` : '';
  const contextLine = [contactName, interactionType, quality].filter(Boolean).join(' · ');

  return buildStructuredSummary({
    title: 'סיכום AI דמו לדיווח קשר',
    text,
    contextLine,
  });
}

export function summarizeBaseMeetingDemo(reportText, meetingMeta = {}) {
  const contextLine = [
    `בית מפגש ${meetingMeta.meeting_place_number || '—'} ב${meetingMeta.meeting_place_city || '—'}`,
    `מפגש ${meetingMeta.meeting_number || '—'} מתוך 4`,
    meetingMeta.activist_name ? `פעיל: ${meetingMeta.activist_name}` : null,
  ].filter(Boolean).join(' · ');

  return buildStructuredSummary({
    title: 'סיכום AI דמו לדיווח מפגש בסיס',
    text: reportText,
    contextLine,
  });
}

export function generateMeetingNotesAiSummaryDemo(house) {
  const meetings = house?.meetings || [];
  if (!meetings.every(m => m.completed)) return '';

  const combinedText = meetings.map(m => m.notes).filter(Boolean).join('\n');
  if (!combinedText.trim()) return 'לא הוזנו הערות למפגשים. לא ניתן להפיק סיכום.';

  const houseLabel = `${house.houseNumber || house.meetingHouseNumber || '—'} ב${house.settlement || house.city || house.meetingHouseCity || '—'}`;

  return [
    `סיכום AI דמו לארבעת המפגשים — בית מפגש ${houseLabel}:`,
    '',
    ...meetings.map(m => `מפגש ${m.meetingNumber} (${m.date || '—'}): ${m.notes || '—'}`),
    '',
    `• מצב הקשר הכולל: ${pickRelationshipStatus(combinedText)}`,
    `• התקדמות רוחנית: ${pickSpiritualProgress(combinedText)}`,
    `• המלצה להמשך: ${pickNextAction(combinedText)}`,
    `• דגלים לרכז: ${pickCoordinatorFlags(combinedText).join(' ')}`,
    '• הערה: ניתוח דמו לפי מילות מפתח. בעתיד יוחלף ב-AI אמיתי.',
  ].join('\n');
}

export function summarizeMeetingHouseSeriesDemo(house, reports = []) {
  const submitted = reports.filter(r => r.submitted);
  const reportCount = submitted.length;
  const firstDate = house?.meetings?.[0]?.date || '—';
  const lastDate = house?.meetings?.[house.meetings.length - 1]?.date || '—';
  const combinedText = submitted.map(r => r.answers).filter(Boolean).join('\n');
  const flags = combinedText ? pickCoordinatorFlags(combinedText) : ['עדיין אין מספיק דיווחים כדי לזהות דגלים.'];
  const spiritual = combinedText ? pickSpiritualProgress(combinedText) : 'עדיין אין מספיק דיווחים כדי לזהות התקדמות רוחנית.';
  const nextAction = combinedText ? pickNextAction(combinedText) : 'להשלים דיווחים חסרים לפני הפקת סיכום מלא.';

  return [
    'סיכום AI דמו לכל ארבעת המפגשים:',
    `• בית מפגש ${house?.houseNumber || '—'} ב${house?.settlement || house?.city || '—'}.`,
    `• טווח מפגשים מתוכנן: ${firstDate} עד ${lastDate}.`,
    `• דווחו בפועל ${reportCount} מתוך 4 מפגשים במערכת הדמו.`,
    `• תמונת קשר: ${combinedText ? pickRelationshipStatus(combinedText) : 'טרם נאספו מספיק דיווחים.'}`,
    `• התקדמות רוחנית: ${spiritual}`,
    `• המלצה לרכז: ${nextAction}`,
    `• דגלים לרכז: ${flags.join(' ')}`,
    '• בשלב עתידי הסיכום יופק מ־AI אמיתי לפי שאלות ודגשים קבועים של הארגון.'
  ].join('\n');
}
