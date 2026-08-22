// pages/contact/update-mitzvot/[id].jsx — עדכון סרגל מצוות
import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../../data/config';
import { useCrm } from '../../../lib/CrmStore';
import { useAuth } from '../../../lib/AuthStore';
import { MITZVOT_BONUS_PER_LEVEL } from '../../../lib/paymentCalc';
import DesktopLayout from '../../../components/DesktopLayout';

export default function UpdateMitzvotPage() {
  const router    = useRouter();
  const { id }    = router.query;
  const contactId = Number(id);
  const { contacts, updateMitzvot } = useCrm();
  const { currentUser } = useAuth();

  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return <DesktopLayout title="עדכון סרגל מצוות"><div>לקוח לא נמצא</div></DesktopLayout>;

  const mitzvotList = contact.gender==='male' ? CONFIG.mitzvotMale : contact.gender==='female' ? CONFIG.mitzvotFemale : CONFIG.mitzvotMale;
  const [mitzvot, setMitzvot] = useState({...(contact.mitzvot||{})});
  const [saved,   setSaved]   = useState(false);
  // מנעול שמירה + הודעת כשל. בלעדיהם לחיצה כפולה יכולה לרשום את אותה עליה פעמיים
  // ב-mitzvot_history, ושמירה שנכשלה הציגה "הסרגל עודכן!" בלי שנשמר דבר.
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const changes = mitzvotList.reduce((acc,m)=>{
    const oldVal = Number(contact.mitzvot?.[m]??0);
    const newVal = Number(mitzvot[m]??0);
    if(newVal>oldVal) acc.push({mitzva:m,from:oldVal,to:newVal,diff:newVal-oldVal});
    return acc;
  },[]);
  // בונוס אחד לכל מצווה שעלתה, בלי קשר לגובה הקפיצה (דיווח מוטי גלעד, 2026-08-02).
  // חייב להישאר זהה לגזירת mitzvotBonuses ב-lib/CrmStore.jsx — זה מה שנכנס לדוח בפועל.
  const totalBonus = changes.length * MITZVOT_BONUS_PER_LEVEL;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveErr('');
    const { error } = await updateMitzvot(contactId, currentUser.id, mitzvot);
    if (error) { setSaveErr(error.message || 'השמירה נכשלה. נסה שוב.'); setSaving(false); return; }
    setSaved(true);
  }

  if (saved) return (
    <DesktopLayout title="סרגל מצוות עודכן">
      <div style={{textAlign:'center',padding:'60px 20px'}}>
        <div style={{fontSize:56,marginBottom:16}}>✨</div>
        <h2 style={{marginBottom:8}}>הסרגל עודכן!</h2>
        {totalBonus>0 && <div style={{fontSize:16,color:'#27ae60',fontWeight:700,marginBottom:8}}>בונוס: {totalBonus.toLocaleString()} ₪</div>}
        <p style={{color:'#aaa',marginBottom:28}}>סרגל המצוות של {contact.name} עודכן בהצלחה.</p>
        <Link href={`/contact/${contactId}`} className="btn btn-primary" style={{textDecoration:'none',padding:'10px 24px'}}>חזרה לפרופיל</Link>
      </div>
    </DesktopLayout>
  );

  return (
    <DesktopLayout title={`עדכון סרגל מצוות — ${contact.name}`} backHref={`/contact/${contactId}`} backLabel="חזרה ←">
      <div style={{maxWidth:540}}>
        <div style={{background:'#fffaf5',borderRadius:14,padding:'18px 20px',marginBottom:14,border:'0.5px solid rgba(0,0,0,0.06)',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
          <div style={{fontSize:13,fontWeight:700,color:'#888',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6}}>
            {contact.gender==='male'?'סרגל מצוות — איש':'סרגל מצוות — אשה'}
          </div>
          <p style={{fontSize:12,color:'#bbb',marginBottom:16}}>דרגות 0–4 · כל מצווה שעולה = בונוס {MITZVOT_BONUS_PER_LEVEL} ₪, גם בקפיצה של כמה רמות</p>
          {mitzvotList.map(mitz=>{
            const oldVal=Number(contact.mitzvot?.[mitz]??0);
            const newVal=Number(mitzvot[mitz]??0);
            const diff=newVal-oldVal;
            return (
              <div key={mitz} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,paddingBottom:12,borderBottom:'0.5px solid #f0f0f0'}}>
                <div>
                  <span style={{fontSize:14,fontWeight:diff>0?700:400,color:diff>0?'#27ae60':'#333'}}>{mitz}</span>
                  {diff>0 && <span style={{fontSize:11,color:'#27ae60',marginRight:6}}> ↑ +{MITZVOT_BONUS_PER_LEVEL}₪</span>}
                  {diff<0 && <span style={{fontSize:11,color:'#e74c3c',marginRight:6}}> ↓</span>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,color:'#bbb'}}>היה: {oldVal}</span>
                  <select value={mitzvot[mitz]??0} onChange={e=>setMitzvot(p=>({...p,[mitz]:Number(e.target.value)}))}
                    style={{padding:'6px 10px',borderRadius:8,border:`1.5px solid ${diff>0?'#27ae60':'#e8e8e8'}`,fontSize:13,background:diff>0?'#edfaf1':'#fafafa',color:diff>0?'#27ae60':'#555',fontFamily:'Rubik,sans-serif',width:90,cursor:'pointer'}}>
                    {[0,1,2,3,4].map(l=><option key={l} value={l}>רמה {l}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        {changes.length>0 && (
          <div style={{background:'#edfaf1',borderRadius:12,padding:'14px 16px',marginBottom:14,border:'0.5px solid #27ae60'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#27ae60',marginBottom:8}}>שינויים שיירשמו:</div>
            {changes.map(c=><div key={c.mitzva} style={{fontSize:13,color:'#27ae60',marginBottom:4}}>✓ {c.mitzva}: {c.from}→{c.to} (+{MITZVOT_BONUS_PER_LEVEL}₪)</div>)}
            <div style={{fontSize:15,fontWeight:700,color:'#27ae60',marginTop:8,paddingTop:8,borderTop:'0.5px solid #b2dfcc'}}>סה"כ בונוס: {totalBonus} ₪</div>
          </div>
        )}
        {saveErr && (
          <div style={{background:'#fff0f0',border:'0.5px solid #e0a0a0',borderRadius:12,padding:'12px 16px',color:'#c0392b',fontSize:13,marginBottom:14}}>
            {saveErr}
          </div>
        )}
        <div style={{display:'flex',gap:10,marginBottom:20}}>
          <Link href={`/contact/${contactId}`} className="btn" style={{flex:1,textAlign:'center',textDecoration:'none'}}>ביטול</Link>
          <button className="btn btn-primary" style={{flex:2,opacity:saving?0.6:1,cursor:saving?'wait':'pointer'}}
            onClick={handleSave} disabled={saving}>{saving ? 'שומר…' : 'שמור עדכון'}</button>
        </div>
      </div>
    </DesktopLayout>
  );
}
