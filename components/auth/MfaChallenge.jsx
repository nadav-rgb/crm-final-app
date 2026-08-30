import { useState } from 'react';
import { useAuth } from '../../lib/AuthStore';

export default function MfaChallenge({ factorId }) {
  const { challengeMfa, verifyMfa, logout } = useAuth();
  const [challengeId, setChallengeId] = useState(null);
  const [challengeFactorId, setChallengeFactorId] = useState(factorId ?? null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function startChallenge() {
    setLoading(true);
    setError('');
    try {
      const result = await challengeMfa(factorId);
      setChallengeId(result.challengeId);
      setChallengeFactorId(result.factorId ?? factorId);
    } catch {
      setError('לא הצלחנו להתחיל את האימות. בדקו את החיבור ונסו שוב.');
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('קוד האימות צריך לכלול 6 ספרות.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await verifyMfa({ factorId: challengeFactorId, challengeId, code });
    } catch {
      setError('הקוד לא אושר. הזינו קוד חדש מאפליקציית האימות.');
    } finally {
      setLoading(false);
    }
  }

  if (!challengeId) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-lg)' }}>
        <p style={{ fontSize: 16, lineHeight: 1.7 }}>לאישור הכניסה נשלח אתגר לאפליקציית האימות.</p>
        {error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16 }}>{error}</p>}
        <button className="btn btn-primary" style={{ background: 'var(--color-brand)' }} type="button" onClick={startChallenge} disabled={loading}>
          {loading ? 'מתחילים…' : 'המשך לאימות'}
        </button>
        <button className="btn" type="button" onClick={logout} disabled={loading}>יציאה</button>
      </div>
    );
  }

  return (
    <form onSubmit={submitCode} style={{ display: 'grid', gap: 'var(--space-lg)' }}>
      <label htmlFor="mfa-code" className="form-label" style={{ fontSize: 16 }}>קוד אימות בן 6 ספרות</label>
      <input
        id="mfa-code"
        className="form-input"
        style={{ fontSize: 16 }}
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        autoFocus
      />
      {error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16 }}>{error}</p>}
      <button className="btn btn-primary" style={{ background: 'var(--color-brand)' }} type="submit" disabled={loading || code.length !== 6}>
        {loading ? 'מאמתים…' : 'אימות וכניסה'}
      </button>
    </form>
  );
}
