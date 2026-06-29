import { requireAuth } from './meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // הגנה על קרדיט Anthropic — רק משתמש מחובר.
  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { text, type, meta = {} } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });

  const systemPrompt = type === 'base_meeting'
    ? `אתה עוזר CRM של ארגון יהודי המקרב יהודים לאורח חיים יהודי. תפקידך לסכם דיווח מפגש בסיס בדיוק שלושה משפטים בעברית — לא פחות ולא יותר. כל משפט מתייחס לנקודה אחת בלבד:

משפט 1 — טיב המפגש: מה עשו? טיילו? אכלו? שתו? על מה דיברו? מה האווירה הייתה?
משפט 2 — פרטי המפגש: כמה זמן נמשך? מי היה נוכח מעבר לפעיל והלקוח? אם היו נוכחים נוספים (אשה, ילדים, חברים) — ציין מי הם ומה המשמעות — האם ניתן להשפיע גם עליהם?
משפט 3 — הערכת הקשר: האם המפגש מעיד על קשר קרוב וטוב? בהתחשב בתוכן הדיווח — האם אנחנו בהתקדמות, עמידה במקום, או נסיגה בקשר עם הלקוח?

כתוב רק את שלושת המשפטים, ללא כותרות, ללא מספור, ללא מקפים. אל תמציא מידע שאינו בדיווח.`
    : `אתה עוזר CRM של ארגון יהודי שמקרב יהודים לתורה ומצוות. נתח את דיווח הקשר עם הלקוח והחזר סיכום ב**נקודות קצרות וחתוכות** בעברית — בלי משפטים ארוכים, בלי הקדמות, בלי פרטים טכניים (מיקום, אוכל וכו'). אל תמציא — מה שלא מופיע בדיווח כתוב "לא צוין".

החזר בדיוק 4 נקודות, כל אחת בשורה שמתחילה ב"• ":
• תורני: האם למדו יחד או נגעו בתוכן של תורה / מצוות / רוחניות? (להבדיל משיחה ידידותית גרידא או נושאים כלליים כמו חינוך ילדים). אם כן — בקצרה מה למדו / על מה דיברו. אם לא — "לא תורני".
• ידידותי: המפגש היה חם וטוב, או פושר / בעייתי?
• התקדמות: בהשוואה למפגש הקודם — התקדמות (ידידותית או תורנית), עמידה במקום, או נסיגה? אם לא ניתן מפגש קודם — "אין מפגש קודם להשוואה".
• משתתפים: כמה נכחו? אם מעבר לפעיל וללקוח — מי הנוכחים ומה הקשר שלהם. אם רק השניים — "הפעיל והלקוח בלבד".

החזר רק את 4 הנקודות, בלי כותרת ובלי טקסט נוסף.`;

  // הקשר מפגשים קודמים (לנקודת "התקדמות") — מועבר מהטופס ב-meta.previous
  const prevList = Array.isArray(meta.previous) ? meta.previous : [];
  const prevBlock = prevList.length
    ? 'מפגשים קודמים (לבדיקת התקדמות, מהחדש לישן):\n' + prevList.map(p =>
        `- ${p.date || '?'} (${[p.type, p.quality].filter(Boolean).join(' ') || 'קשר'}): ${(p.summary || '').trim() || 'אין תקציר'}`
      ).join('\n') + '\n\n'
    : '';

  const userPrompt = type === 'base_meeting'
    ? `סכם את הדיווח הבא על מפגש בסיס${meta.meeting_place_city ? ` ב${meta.meeting_place_city}` : ''}${meta.activist_name ? ` של ${meta.activist_name}` : ''}:\n\n${text}`
    : `לקוח: ${meta.contactName ?? 'לקוח'}. סוג שנבחר בטופס: ${[meta.type, meta.quality].filter(Boolean).join(' ') || 'לא צוין'}.\n\n${prevBlock}דיווח המפגש הנוכחי:\n${text}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 450,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ error: data.error?.message ?? 'Anthropic error' });
    }

    const summary = data.content?.[0]?.text ?? '';
    return res.status(200).json({ summary });
  } catch (e) {
    console.error('AI summary error:', e);
    return res.status(500).json({ error: e.message });
  }
}
