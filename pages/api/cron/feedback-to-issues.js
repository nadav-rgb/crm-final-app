// pages/api/cron/feedback-to-issues.js — Vercel Cron
// גשר: כל דיווח חדש בעמוד /feedback נפתח כ-issue ב-GitHub.
//
// למה: סוכן הטריאז' השבועי (routine בענן) צריך לקרוא את הדיווחים, אבל אסור לתת לו את
// SUPABASE_SECRET_KEY — זה מפתח service-role שעוקף RLS ורואה את כל נתוני כל הפעילים,
// וסביבת הריצה של הסוכן מצהירה במפורש שמשתני הסביבה שלה גלויים. במקום זה: הסוד נשאר
// כאן ב-Vercel, והסוכן קורא issues בריפו שאליו כבר יש לו גישה.
//
// Dedup דרך העמודה issue_url (migration 0017) — שורה שכבר יש לה issue לא נפתחת שוב.
// דורש GITHUB_TOKEN ב-Vercel עם הרשאת issues:write על הריפו.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

const REPO = process.env.GITHUB_REPO || 'nadav-rgb/crm-final-app';

const CATEGORY_LABEL = { bug: '🐞 באג / תקלה', stuck: '🚧 תקיעה', suggestion: '💡 הצעת שיפור' };

function issueBody(r) {
  return [
    `**מדווח:** ${r.reporter_name || '—'} (קוד ${r.reporter_id})`,
    `**סוג:** ${CATEGORY_LABEL[r.category] || r.category}`,
    `**תאריך דיווח:** ${new Date(r.created_at).toLocaleDateString('he-IL')}`,
    `**פרויקט:** ${r.project_id ?? '—'}`,
    '',
    '---',
    '',
    r.message,
    '',
    '---',
    '',
    `_נפתח אוטומטית מעמוד /feedback. מזהה דיווח: \`${r.id}\`_`,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  // כשל גלוי ומוסבר, לא no-op שקט: בלי טוקן אין גשר, ועדיף לדעת מזה מלחשוב שהכל עובד.
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: 'GITHUB_TOKEN missing',
      hint: 'הוסף GITHUB_TOKEN (issues:write על הריפו) ב-Vercel → Settings → Environment Variables',
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: reports, error } = await supabase
    .from('feedback_reports')
    .select('id, reporter_id, reporter_name, project_id, category, message, status, created_at')
    .is('issue_url', null)
    .neq('status', 'reviewed')
    .order('created_at', { ascending: true })
    .limit(25);

  // אם 0017 טרם הורצה — PostgREST יחזיר שגיאה על issue_url. מחזירים אותה כמו שהיא.
  if (error) {
    return res.status(500).json({ error: error.message, hint: 'ייתכן ש-migrations/0017_feedback_issue_url.sql טרם הורצה' });
  }
  if (!reports?.length) return res.status(200).json({ created: 0, scanned: 0 });

  const created = [];
  const failed = [];

  for (const r of reports) {
    const title = `[${CATEGORY_LABEL[r.category] || r.category}] ${String(r.message).split('\n')[0].slice(0, 70)}`;
    try {
      const gh = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body: issueBody(r), labels: ['feedback', r.category] }),
      });

      if (!gh.ok) {
        const detail = await gh.text().catch(() => '');
        failed.push({ id: r.id, status: gh.status, detail: detail.slice(0, 200) });
        continue;
      }

      const issue = await gh.json();
      // מסמנים רק אחרי שה-issue באמת נוצר — כך שכשל מוביל לניסיון חוזר בריצה הבאה,
      // ולא לדיווח שנעלם בשקט בלי issue.
      const { error: updErr } = await supabase
        .from('feedback_reports')
        .update({ issue_url: issue.html_url })
        .eq('id', r.id);

      if (updErr) failed.push({ id: r.id, detail: `issue נוצר (${issue.html_url}) אבל העדכון נכשל: ${updErr.message}` });
      else created.push(issue.html_url);
    } catch (e) {
      failed.push({ id: r.id, detail: e?.message || String(e) });
    }
  }

  return res.status(200).json({ scanned: reports.length, created: created.length, issues: created, failed });
}
