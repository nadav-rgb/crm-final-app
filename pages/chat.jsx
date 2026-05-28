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
    <DesktopLayout title="צ׳אט פעילים">
      <div style={{ textAlign:'center', padding:'80px 20px', color:'#aaa' }}>
        <div style={{ fontSize:52, marginBottom:16 }}>💬</div>
        <div style={{ fontSize:20, fontWeight:800, color:'#6c5ce7', marginBottom:10 }}>בקרוב</div>
        <div style={{ fontSize:14, color:'#bbb', maxWidth:320, margin:'0 auto', lineHeight:1.8 }}>
          צ׳אט פנימי בין פעילים — יושק בגרסה הבאה.
        </div>
      </div>
    </DesktopLayout>
  );
}
