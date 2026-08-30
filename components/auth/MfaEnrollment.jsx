import { useState } from 'react';
import { useAuth } from '../../lib/AuthStore';
import MfaChallenge from './MfaChallenge';

export default function MfaEnrollment() {
  const { mfaEnrolled, enrollMfa, logout } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const factorId = enrollment?.factorId;

  async function enroll() {
    setLoading(true);
    setError('');
    try {
      setEnrollment(await enrollMfa());
    } catch {
      setError('לא הצלחנו ליצור אמצעי אימות. נסו שוב או פנו למנהל המערכת.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      padding: 'var(--space-2xl)', background: 'var(--color-bg)',
    }}>
      <section aria-labelledby="mfa-title" style={{
        width: 'min(100%, 440px)', background: 'var(--color-card)',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-raised)', padding: 'var(--space-2xl)',
      }}>
        <p style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 16, marginBottom: 'var(--space-sm)' }}>
          אימות מוגבר
        </p>
        <h1 id="mfa-title" style={{ marginBottom: 'var(--space-sm)', letterSpacing: 0 }}>עוד שלב קצר לפני הכניסה</h1>
        <p style={{ fontSize: 16, lineHeight: 1.7, marginBottom: 'var(--space-2xl)' }}>
          החשבון הזה מוגן באימות דו־שלבי.
        </p>

        {mfaEnrolled || factorId ? (
          <>
            {enrollment?.qrCode && (
              <div style={{ marginBottom: 'var(--space-2xl)' }}>
                <p style={{ fontSize: 16, lineHeight: 1.7, marginBottom: 'var(--space-lg)' }}>
                  סרקו את הקוד באפליקציית אימות, ואז המשיכו להזנת הקוד.
                </p>
                <img src={enrollment.qrCode} alt="קוד QR להגדרת אימות דו־שלבי" width="220" height="220" style={{ display: 'block', maxWidth: '100%', marginInline: 'auto' }} />
              </div>
            )}
            <MfaChallenge factorId={factorId} />
          </>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-lg)' }}>
            <p style={{ fontSize: 16, lineHeight: 1.7 }}>הגדירו אפליקציית אימות כדי להגן על המידע הרגיש במערכת.</p>
            {error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 16 }}>{error}</p>}
            <button className="btn btn-primary" style={{ background: 'var(--color-brand)' }} type="button" onClick={enroll} disabled={loading}>
              {loading ? 'מגדירים…' : 'הגדרת אימות'}
            </button>
            <button className="btn" type="button" onClick={logout} disabled={loading}>יציאה</button>
          </div>
        )}
      </section>
    </main>
  );
}
