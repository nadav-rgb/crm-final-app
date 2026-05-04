import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text, type, meta = {} } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });

  const systemPrompt = type === 'base_meeting'
    ? `אתה עוזר CRM של ארגון יהודי. תפקידך לסכם דיווח מפגש בסיס בעברית, בצורה קצרה וברורה (2-4 משפטים).
הדגש: מה קרה במפגש, מי השתתף, מה הפוטנציאל, ומה הצעד הבא. אל תמציא מידע שאינו בטקסט.`
    : `אתה עוזר CRM של ארגון יהודי. תפקידך לסכם דיווח קשר עם לקוח בעברית, בצורה קצרה וברורה (1-3 משפטים).
הדגש: מה נאמר, מה מצב הקשר, ומה הצעד הבא.`;

  const userPrompt = type === 'base_meeting'
    ? `סכם את הדיווח הבא על מפגש בסיס${meta.meeting_place_city ? ` ב${meta.meeting_place_city}` : ''}${meta.activist_name ? ` של ${meta.activist_name}` : ''}:\n\n${text}`
    : `סכם את הדיווח הבא על קשר עם ${meta.contactName ?? 'לקוח'}:\n\n${text}`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const summary = message.content[0]?.text ?? '';
    return res.status(200).json({ summary });
  } catch (e) {
    console.error('AI summary error:', e);
    return res.status(500).json({ error: e.message });
  }
}
