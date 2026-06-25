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
    : `אתה עוזר CRM של ארגון יהודי. תפקידך לסכם דיווח קשר עם לקוח בעברית, בצורה קצרה וברורה (1-3 משפטים). הדגש: מה נאמר, מה מצב הקשר, ומה הצעד הבא.`;

  const userPrompt = type === 'base_meeting'
    ? `סכם את הדיווח הבא על מפגש בסיס${meta.meeting_place_city ? ` ב${meta.meeting_place_city}` : ''}${meta.activist_name ? ` של ${meta.activist_name}` : ''}:\n\n${text}`
    : `סכם את הדיווח הבא על קשר עם ${meta.contactName ?? 'לקוח'}:\n\n${text}`;

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
        max_tokens: 300,
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
