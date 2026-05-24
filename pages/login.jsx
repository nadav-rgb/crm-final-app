// pages/login.jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';

export default function LoginPage() {
  const { login, loginError } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit() {
    if (!username || !password) return;
    const ok = await login(username, password);
    if (ok) router.push('/landing');
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0f0e1a', padding: 24,
    }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: '#534ab7', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 28, color: '#fff',
          margin: '0 auto 12px',
        }}>מ</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>מקרבים</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>מערכת ניהול פעילים</p>
      </div>

      <div style={{
        background: '#1a1830', borderRadius: 16, padding: 28,
        width: '100%', maxWidth: 360,
        border: '0.5px solid rgba(255,255,255,0.1)',
      }}>
        <label className="form-label" style={{ color: 'rgba(255,255,255,0.7)' }}>שם משתמש</label>
        <input type="text" className="form-input"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', marginBottom: 16 }}
          placeholder="הכנס שם משתמש" value={username}
          onChange={e => setUsername(e.target.value)} onKeyDown={handleKey}
          autoFocus autoComplete="username" />

        <label className="form-label" style={{ color: 'rgba(255,255,255,0.7)' }}>סיסמה</label>
        <input type="password" className="form-input"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', marginBottom: loginError ? 8 : 24 }}
          placeholder="הכנס סיסמה" value={password}
          onChange={e => setPassword(e.target.value)} onKeyDown={handleKey}
          autoComplete="current-password" />

        {loginError && <p style={{ fontSize: 13, color: '#e24b4a', marginBottom: 16, textAlign: 'center' }}>{loginError}</p>}

        <button className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: 15 }} onClick={handleSubmit}>
          כניסה
        </button>
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 1.8 }}>
        <div>משתמשי הדגמה:</div>
        <div>מנכ"ל: ceo / ceo123</div>
        <div>רכז: coord1 / coord123</div>
        <div>פעיל: activist1 / activist123</div>
      </div>
    </div>
  );
}
