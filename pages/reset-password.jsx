import { useState } from 'react';
import { useAuth } from '../lib/AuthStore';

export default function ResetPasswordPage() {
  const { authState, completePasswordReset } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (password.length < 12) {
      setError('הסיסמה צריכה לכלול לפחות 12 תווים.');
      return;
    }
    if (password !== confirmation) {
      setError('הסיסמאות אינן זהות. תקנו ונסו שוב.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await completePasswordReset(password);
      setDone(true);
    } catch {
      setError('הקישור פג או שהעדכון נכשל. בקשו קישור חדש ונסו שוב.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      padding: 'var(--space-2xl)', background: 'var(--color-bg)',
    }}>
      <section aria-labelledby="reset-title" style={{
        width: 'min(100%, 420px)', background: 'var(--color-card)',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-raised)', padding: 'var(--space-2xl)',
      }}>
        <h1 id="reset-title" style={{ marginBottom: 'var(--space-md)', letterSpacing: 0 }}>בחירת סיסמה חדשה</h1>
        {done ? (
          <p role="status" style={{ fontSize: 16, lineHeight: 1.7 }}>הסיסמה עודכנה וכל החיבורים הקודמים בוטלו. אפשר לחזור למסך הכניסה.</p>
        ) : authState !== 'recovery' ? (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16, lineHeight: 1.7 }}>קישור האיפוס אינו פעיל. בקשו קישור חדש ממסך הכניסה.</p>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-lg)' }}>
            <p style={{ fontSize: 16, lineHeight: 1.7 }}>בחרו סיסמה ייחודית באורך 12 תווים לפחות.</p>
            <div>
              <label className="form-label" htmlFor="new-password" style={{ fontSize: 16 }}>סיסמה חדשה</label>
              <input id="new-password" className="form-input" type="password" dir="ltr"
                style={{ fontSize: 16 }}
                autoComplete="new-password" value={password}
                onChange={(event) => setPassword(event.target.value)} disabled={loading} />
            </div>
            <div>
              <label className="form-label" htmlFor="confirm-password" style={{ fontSize: 16 }}>אימות הסיסמה</label>
              <input id="confirm-password" className="form-input" type="password" dir="ltr"
                style={{ fontSize: 16 }}
                autoComplete="new-password" value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} disabled={loading} />
            </div>
            {error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16, lineHeight: 1.7 }}>{error}</p>}
            <button className="btn btn-primary" style={{ background: 'var(--color-brand)' }} type="submit" disabled={loading}>
              {loading ? 'מעדכנים…' : 'עדכון סיסמה'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
