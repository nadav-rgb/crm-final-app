// pages/trash.jsx — סל מיחזור: פעילים ולקוחות שנמחקו, ניתנים לשחזור 90 יום.
import { useState, useEffect } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import { authHeader } from '../lib/apiAuth';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
function daysLeft(deletedAt) {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((NINETY_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
}

export default function Trash() {
  const { can, currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(null); // { entity, id, name }

  async function load() {
    if (!currentUser) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: contacts }, { data: activists }] = await Promise.all([
      supabase.from('contacts').select('id, name, deleted_at').not('deleted_at', 'is', null),
      currentUser.role === 'ceo' || currentUser.role === 'coord' || currentUser.role === 'head'
        ? supabase.from('profiles').select('activist_code, name, deleted_at').not('deleted_at', 'is', null)
        : Promise.resolve({ data: [] }),
    ]);
    const combined = [
      ...(contacts || []).map(c => ({ entity: 'contact', id: c.id, name: c.name, deletedAt: c.deleted_at })),
      ...(activists || []).map(a => ({ entity: 'activist', id: a.activist_code, name: a.name, deletedAt: a.deleted_at })),
    ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    setRows(combined);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentUser]);

  async function callAction(entity, id, action) {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/soft-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ entity, id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.error || 'הפעולה נכשלה'); return; }
      setConfirmPurge(null);
      await load();
    } catch (err) {
      alert('שגיאת רשת: ' + (err.message || 'נסה שוב'));
    } finally {
      setBusyId(null);
    }
  }

  if (!can.manageDeleted) {
    return <DesktopLayout title="סל מיחזור"><p style={{ padding: 24 }}>אין לך הרשאה לצפות בעמוד הזה.</p></DesktopLayout>;
  }

  return (
    <DesktopLayout title="סל מיחזור">
      <div style={{ padding: 24 }}>
        {loading && <p>טוען…</p>}
        {!loading && rows.length === 0 && <p>אין פריטים מחוקים כרגע.</p>}
        {!loading && rows.map(r => {
          const left = daysLeft(r.deletedAt);
          return (
            <div key={`${r.entity}-${r.id}`} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.name} <span style={{ fontSize: 12, color: '#aaa' }}>({r.entity === 'activist' ? 'פעיל' : 'לקוח'})</span></div>
                <div style={{ fontSize: 12, color: '#888' }}>נמחק ב-{new Date(r.deletedAt).toLocaleDateString('he-IL')} · {left > 0 ? `נותרו ${left} ימים לשחזור` : 'תם חלון השחזור'}</div>
              </div>
              {left > 0 ? (
                <button className="btn" disabled={busyId === r.id} onClick={() => callAction(r.entity, r.id, 'restore')}>↺ שחזור</button>
              ) : (
                <button className="btn" style={{ color: '#a32d2d', borderColor: '#d98a8a' }} disabled={busyId === r.id}
                  onClick={() => setConfirmPurge(r)}>🗑️ מחיקה סופית</button>
              )}
            </div>
          );
        })}
      </div>

      {confirmPurge && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}
          onClick={() => setConfirmPurge(null)}>
          <div className="card" style={{ padding: 24, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginTop: 0 }}>
              למחוק לצמיתות את <strong>{confirmPurge.name}</strong>?
              {confirmPurge.entity === 'activist' && ' כל אנשי הקשר שנמחקו יחד איתו יימחקו לצמיתות גם הם.'}
              {' '}לא ניתן לבטל פעולה זו.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmPurge(null)}>ביטול</button>
              <button className="btn" style={{ background: '#a32d2d', color: '#fff' }}
                onClick={() => callAction(confirmPurge.entity, confirmPurge.id, 'purge')}>מחק לצמיתות</button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}
