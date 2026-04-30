import { useState } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { INITIAL_CHAT_MESSAGES } from '../lib/chatDemo';

export default function ChatDemoPage() {
  const { currentUser, activeProject } = useAuth();
  const [messages, setMessages] = useState(INITIAL_CHAT_MESSAGES);
  const [text, setText] = useState('');

  function sendDemoMessage() {
    const clean = text.trim();
    if (!clean) return;
    const now = new Date();
    setMessages(prev => [...prev, {
      id: Date.now(),
      user: currentUser?.name || 'משתמש',
      project: activeProject?.name || 'כללי',
      text: clean,
      time: now.toTimeString().slice(0, 5),
      demo: true,
    }]);
    setText('');
  }

  return (
    <DesktopLayout title="צ׳אט פעילים" subtitle="דמו בלבד · שיחה פנימית בין פעילים מכל הפרויקטים">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ background:'#fffaf5', border:'0.5px solid rgba(0,0,0,0.07)', borderRadius:14, padding:'14px 18px', marginBottom:14, color:'#6b5a49', fontSize:13, lineHeight:1.7 }}>
          זהו צ׳אט הדגמה בלבד. ההודעות נשמרות כרגע בזיכרון המקומי של המסך ולא נשלחות לשרת. בעתיד אפשר לחבר את אותו מסך למסד נתונים בזמן אמת.
        </div>

        <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:18, minHeight:420, padding:18, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:10 }}>
            {messages.map(message => {
              const mine = message.user === currentUser?.name;
              return (
                <div key={message.id} style={{ display:'flex', justifyContent: mine ? 'flex-start' : 'flex-end' }}>
                  <div style={{ maxWidth:'72%', background: mine ? '#f0effe' : '#fffaf5', border:'0.5px solid #eee', borderRadius:14, padding:'10px 12px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:18, marginBottom:5, fontSize:11, color:'#999' }}>
                      <b style={{ color:'#6c5ce7' }}>{message.user}</b>
                      <span>{message.project} · {message.time}</span>
                    </div>
                    <div style={{ fontSize:14, color:'#333', lineHeight:1.55 }}>{message.text}</div>
                    {message.demo && <div style={{ fontSize:10, color:'#aaa', marginTop:5 }}>נוסף בדמו בלבד</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop:'0.5px solid #eee', paddingTop:12, display:'flex', gap:10 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendDemoMessage(); }} placeholder="כתוב הודעה לדמו..." style={{ flex:1, border:'1.5px solid #e8e8e8', borderRadius:12, padding:'11px 12px', fontFamily:'inherit', fontSize:14 }} />
            <button onClick={sendDemoMessage} disabled={!text.trim()} style={{ border:'none', borderRadius:12, padding:'11px 18px', fontFamily:'inherit', fontWeight:800, cursor:text.trim()?'pointer':'not-allowed', background:text.trim()?'#6c5ce7':'#ddd', color:'#fff' }}>
              שלח בדמו
            </button>
          </div>
        </div>
      </div>
    </DesktopLayout>
  );
}
