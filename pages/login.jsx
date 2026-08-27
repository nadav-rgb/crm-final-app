import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';

export default function LoginPage() {
  const { login, loginError, requestPasswordReset } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (ok) router.push('/landing');
  }

  async function handleReset() {
    if (!username.trim()) {
      setResetMessage('הזינו קודם את שם המשתמש.');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(username);
      setResetMessage('אם החשבון קיים, נשלחו אליו הוראות לאיפוס הסיסמה.');
    } catch {
      setResetMessage('לא הצלחנו לשלוח כרגע. נסו שוב בעוד כמה דקות.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      padding: 'var(--space-2xl)', background: 'var(--color-bg)',
    }}>
      <section aria-labelledby="login-title" style={{ width: 'min(100%, 400px)' }}>
        <header style={{ marginBottom: 'var(--space-2xl)', textAlign: 'center' }}>
          <div aria-hidden="true" style={{
            width: 56, height: 56, display: 'grid', placeItems: 'center',
            marginInline: 'auto', marginBottom: 'var(--space-md)',
            borderRadius: 'var(--radius-full)', background: 'var(--color-brand)',
            color: 'var(--color-white)', fontSize: 24, fontWeight: 700,
          }}>מ</div>
          <h1 id="login-title" style={{ fontSize: 24, letterSpacing: 0 }}>כניסה למקרבים</h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, marginTop: 'var(--space-sm)' }}>הזינו את פרטי החשבון האישי.</p>
        </header>

        <form onSubmit={handleSubmit} style={{
          display: 'grid', gap: 'var(--space-lg)', background: 'var(--color-card)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-raised)', padding: 'var(--space-2xl)',
        }}>
          <div>
            <label className="form-label" htmlFor="username" style={{ fontSize: 16 }}>שם משתמש</label>
            <input id="username" type="text" className="form-input" dir="auto"
              style={{ fontSize: 16 }}
              value={username} onChange={(event) => setUsername(event.target.value)}
              autoComplete="username" autoFocus disabled={loading} />
          </div>
          <div>
            <label className="form-label" htmlFor="password" style={{ fontSize: 16 }}>סיסמה</label>
            <input id="password" type="password" className="form-input" dir="ltr"
              style={{ fontSize: 16 }}
              value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password" disabled={loading} />
          </div>
          {loginError && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16, lineHeight: 1.7 }}>{loginError}</p>}
          {resetMessage && <p role="status" style={{ fontSize: 16, lineHeight: 1.7 }}>{resetMessage}</p>}
          <button className="btn btn-primary" style={{ background: 'var(--color-brand)' }} type="submit" disabled={loading || !username.trim() || !password}>
            {loading ? 'מתחברים…' : 'כניסה'}
          </button>
          <button className="btn" type="button" onClick={handleReset} disabled={loading}>איפוס סיסמה</button>
        </form>
      </section>
    </main>
  );
}
