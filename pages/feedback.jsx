// pages/feedback.jsx — תקלות והצעות: כל פעיל יכול לדווח על באג/תקיעה/הצעה, ורכזים/מנכ"ל סוקרים.
import { useEffect, useState } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';

const CATEGORY_OPTIONS = [
  { value: 'bug',        label: '🐞 באג / תקלה' },
  { value: 'stuck',      label: '🚧 תקיעה — לא מצליח להמשיך' },
  { value: 'suggestion', label: '💡 הצעה לשיפור' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map(o => [o.value, o.label]));

export default function FeedbackPage() {
  const { currentUser, apiFetch } = useAuth();
  const canReview = ['coord', 'head', 'ceo'].includes(currentUser?.role);

  const [category, setCategory] = useState('bug');
  const [message,  setMessage]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);

  const [mine,   setMine]   = useState([]);
  const [review, setReview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);   // הודעת שגיאה גלויה למשתמש

  function classify(err) {
    if (!err) return false;
    setError('לא הצלחנו להשלים את הפעולה. אפשר לנסות שוב בעוד רגע.');
    return true;
  }

  async function loadFeedback() {
    if (!currentUser?.userId) return;
    try {
      const result = await apiFetch('/api/feedback', { method: 'GET' });
      const rows = result.feedback || [];
      setMine(rows.filter((item) => item.reporterUserId === currentUser.userId));
      setReview(canReview ? rows : []);
      setError(null);
    } catch (err) {
      classify(err);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadFeedback();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.userId, canReview, apiFetch]);

  async function handleSubmit() {
    if (!message.trim() || !currentUser?.userId) return;
    setSending(true);
    setError(null);
    let err = null;
    try { await apiFetch('/api/feedback', { method: 'POST', body: { category, message: message.trim() } }); }
    catch (caught) { err = caught; }
    setSending(false);
    if (err) { classify(err); return; }   // הטקסט נשאר בתיבה — שלא יאבד למשתמש
    setMessage('');
    setSent(true);
    setTimeout(() => setSent(false), 3000);
    await loadFeedback();
  }

  async function toggleStatus(item) {
    const nextStatus = item.status === 'open' ? 'reviewed' : 'open';
    let err = null;
    try { await apiFetch('/api/feedback', { method: 'PATCH', body: { id: item.id, status: nextStatus } }); }
    catch (caught) { err = caught; }
    if (err) { classify(err); return; }
    setReview(prev => prev.map(r => r.id === item.id ? { ...r, status: nextStatus } : r));
  }

  return (
    <DesktopLayout title="תקלות והצעות" subtitle="דווחו על באגים, תקיעות או רעיונות לשיפור — נעבור על זה יחד כל כמה ימים">
      {error && (
        <div style={{ background:'#fdecea', border:'0.5px solid rgba(226,75,74,0.3)', borderRight:'3px solid #e24b4a', borderRadius:12, padding:'12px 16px', marginBottom:18, maxWidth:640, fontSize:12.5, color:'#a63230', lineHeight:1.6 }}>
          <strong>הפעולה נכשלה.</strong> {error}
        </div>
      )}

      {/* טופס דיווח */}
      <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.07)', borderRadius:16, padding:'20px 22px', marginBottom:22, maxWidth:640 }}>
        <div style={{ fontSize:15, fontWeight:800, color:'#2d1f5e', marginBottom:14 }}>דיווח חדש</div>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
          {CATEGORY_OPTIONS.map(opt => (
            <button key={opt.value} type="button" onClick={() => setCategory(opt.value)}
              style={{
                padding:'7px 14px', borderRadius:20, fontSize:12.5, fontFamily:'inherit', cursor:'pointer',
                border:`1.5px solid ${category === opt.value ? '#6c5ce7' : '#e0e0e0'}`,
                background: category === opt.value ? '#6c5ce7' : '#fafafa',
                color: category === opt.value ? '#fff' : '#555',
                fontWeight: category === opt.value ? 700 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={4}
          placeholder="ספרו לנו מה קרה או מה הרעיון שלכם..."
          style={{
            width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e0e0e0',
            fontSize:13, fontFamily:'Rubik,sans-serif', boxSizing:'border-box', direction:'rtl',
            resize:'vertical', minHeight:90, outline:'none',
          }}
        />

        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:12 }}>
          <button onClick={handleSubmit} disabled={!message.trim() || sending}
            style={{
              padding:'10px 22px', borderRadius:12, border:'none', fontSize:13, fontWeight:700,
              cursor: message.trim() && !sending ? 'pointer' : 'not-allowed',
              background: message.trim() && !sending ? 'linear-gradient(135deg,#6c5ce7,#a29bfe)' : '#ddd',
              color: message.trim() && !sending ? '#fff' : '#999', fontFamily:'Rubik,sans-serif',
            }}>
            {sending ? 'שולח...' : 'שלח דיווח'}
          </button>
          {sent && <span style={{ color:'#27ae60', fontSize:12.5, fontWeight:700 }}>✓ נשלח, תודה!</span>}
        </div>
      </div>

      {/* ההגשות שלי */}
      <div style={{ marginBottom: canReview ? 28 : 0 }}>
        <div style={{ fontSize:14, fontWeight:800, color:'#2d1f5e', marginBottom:10 }}>ההגשות שלי</div>
        {loading ? (
          <div style={{ color:'#aaa', fontSize:13 }}>טוען...</div>
        ) : mine.length === 0 ? (
          <div style={{ color:'#aaa', fontSize:13 }}>עוד לא הגשת דיווח.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxWidth:640 }}>
            {mine.map(item => <FeedbackCard key={item.id} item={item} />)}
          </div>
        )}
      </div>

      {/* סקירה — רכזים/מנכ"ל */}
      {canReview && (
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#2d1f5e', marginBottom:10 }}>
            כל ההגשות לסקירה {review.filter(r => r.status === 'open').length > 0 && (
              <span style={{ fontSize:11, color:'#d68910', fontWeight:700 }}>
                ({review.filter(r => r.status === 'open').length} ממתינות)
              </span>
            )}
          </div>
          {loading ? (
            <div style={{ color:'#aaa', fontSize:13 }}>טוען...</div>
          ) : review.length === 0 ? (
            <div style={{ color:'#aaa', fontSize:13 }}>אין דיווחים.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxWidth:640 }}>
              {review.map(item => (
                <FeedbackCard key={item.id} item={item} showReporter onToggle={() => toggleStatus(item)} />
              ))}
            </div>
          )}
        </div>
      )}
    </DesktopLayout>
  );
}

function FeedbackCard({ item, showReporter, onToggle }) {
  const isOpen = item.status === 'open';
  return (
    <div style={{
      background: isOpen ? '#fffaf5' : '#f8fdf9',
      border:`0.5px solid ${isOpen ? 'rgba(0,0,0,0.07)' : 'rgba(39,174,96,0.2)'}`,
      borderRight:`3px solid ${isOpen ? '#f39c12' : '#27ae60'}`,
      borderRadius:12, padding:'12px 14px',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:6 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#555' }}>{CATEGORY_LABEL[item.category] || item.category}</span>
        <span style={{
          fontSize:11, padding:'2px 9px', borderRadius:20, fontWeight:700,
          background: isOpen ? '#fff8ec' : '#edfaf1', color: isOpen ? '#d68910' : '#27ae60', flexShrink:0,
        }}>
          {isOpen ? 'ממתין' : '✓ נסקר'}
        </span>
      </div>
      {showReporter && (
        <div style={{ fontSize:11.5, color:'#999', marginBottom:4 }}>{item.reporter_name || 'פעיל'}</div>
      )}
      <div style={{ fontSize:13, color:'#333', whiteSpace:'pre-wrap', lineHeight:1.6 }}>{item.message}</div>
      <div style={{ fontSize:11, color:'#bbb', marginTop:6 }}>
        {new Date(item.createdAt).toLocaleDateString('he-IL')}
      </div>
      {onToggle && (
        <button type="button" onClick={onToggle}
          style={{ marginTop:8, border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', background: isOpen ? '#edfaf1' : '#fff4df', color: isOpen ? '#27ae60' : '#b06b00' }}>
          {isOpen ? '✓ סמן כנסקר' : '↺ החזר לממתין'}
        </button>
      )}
    </div>
  );
}
