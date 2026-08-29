// lib/AuthStore.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import projects from '../data/projects';
import { getSupabaseClient } from './supabaseClient';

const AuthContext = createContext(null);

// מיפוי username (שם מלא בעברית) → email ב-Supabase Auth.
// סכמה אחידה — provisioning השקה 2026-06-29. שם המשתמש של כל אחד = השם המלא שלו.
const USERNAME_TO_EMAIL = {
  // === רכזים ===
  'נדב לבון':         'nadav@achdut-crm.test',
  'שמעון קורלנסקי':   'korlansky@achdut-crm.test',
  'הדס לוי':          'hadaslevi@achdut-crm.test',   // רכזת נעים להכיר (project 2 בלבד)
  'הרבנית אילני':     'ilani@achdut-crm.test',       // רכזת אחדות יהודית (project 1 בלבד)
  // === פעילים (אחדות יהודית) ===
  'אלעזר באום':       'mekarvim01@achdut-crm.test',
  'בנימין קליימן':    'mekarvim02@achdut-crm.test',
  'דבורה ידיד':       'mekarvim03@achdut-crm.test',
  'דוד הרשל':         'mekarvim04@achdut-crm.test',
  'דוד רוזנצוויג':    'mekarvim05@achdut-crm.test',
  'חדוה מור יוסף':    'mekarvim06@achdut-crm.test',
  'חיים פייגנבוים':   'mekarvim07@achdut-crm.test',
  'יהושע לוונשטיין':  'mekarvim08@achdut-crm.test',
  'יהושע מן':         'mekarvim09@achdut-crm.test',
  'יהלי ברזל':        'mekarvim10@achdut-crm.test',
  'יוחנן סלייטר':     'mekarvim11@achdut-crm.test',
  'יעקב הופט':        'mekarvim12@achdut-crm.test',
  'יעקב פינקלשטיין':  'mekarvim13@achdut-crm.test',
  'יצחק וינטר':       'mekarvim14@achdut-crm.test',
  'ליזי וידרקר':      'mekarvim15@achdut-crm.test',
  'מוטי שטרלינג':     'mekarvim17@achdut-crm.test',
  'מירי אריאלי':      'mekarvim18@achdut-crm.test',
  'נחמיה גרטש':       'mekarvim19@achdut-crm.test',
  'ניר קובי':         'mekarvim20@achdut-crm.test',
  'נתי סלומון':       'mekarvim21@achdut-crm.test',
  'פסח זאק':          'mekarvim22@achdut-crm.test',
  'צביקה רוזנצוייג':  'mekarvim23@achdut-crm.test',
  'רונן ישראלי':      'mekarvim24@achdut-crm.test',
  'ריקי וילינגר':     'mekarvim25@achdut-crm.test',
  'רפאל טפר':         'mekarvim26@achdut-crm.test',
  'רפאל רייטן':       'mekarvim27@achdut-crm.test',
  'שירה שם טוב':      'mekarvim28@achdut-crm.test',
  'מוטי גלעד':        'mekarvim29@achdut-crm.test',
  'רוזי גרטש':        'mekarvim16@achdut-crm.test',
  'נעמי סלומון':      'mekarvim30@achdut-crm.test',
  'עמיחי וילינגר':    'mekarvim31@achdut-crm.test',
  'חגית אריאלי':      'mekarvim35@achdut-crm.test',
  'יונתן מור יוסף':   'mekarvim36@achdut-crm.test',
  'שמואל הכט':        'mekarvim37@achdut-crm.test',
  'ישראל מרוויס':     'mekarvim38@achdut-crm.test',
  'עזרא הללויה':      'mekarvim39@achdut-crm.test',
  // === פעילים (נעים להכיר) ===
  'רפאל קליימן':      'mekarvim32@achdut-crm.test',
  'אלי לינקר':        'mekarvim33@achdut-crm.test',
  'דרור הראל':        'mekarvim34@achdut-crm.test',
  // === מנכ"ל ===
  'הרב גרינבוים':     'rabbigreenboim@achdut-crm.test',
  'מנכ״ל':            'rabbigreenboim@achdut-crm.test',
};

// קלט יכול להיות email מלא או username — מחזיר תמיד email
function resolveEmail(input) {
  const value = (input || '').trim();
  if (value.includes('@')) return value;                      // הוקלד email מלא
  const key = value.toLowerCase();
  return USERNAME_TO_EMAIL[key] || `${key}@achdut-crm.test`;  // username → email
}

export function AuthProvider({ children }) {
  const [currentUser,    setCurrentUser]    = useState(null);
  const [activeProject,  setActiveProject]  = useState(null);
  const [filterProject,  setFilterProject]  = useState(null); // null = כל הפרויקטים
  const [loginError,     setLoginError]     = useState('');
  const [authLoading,    setAuthLoading]    = useState(true);  // אמת בזמן שחזור session ראשוני

  // עזר משותף: שולף profile מ-Auth user ובונה את currentUser (זהה ל-login ולשחזור)
  async function applyProfile(supabase, authUser) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('activist_code, name, role, project_id, project_ids')
      .eq('id', authUser.id)
      .single();
    if (error || !profile) return false;

    const user = {
      id:         Number(profile.activist_code), // נשאר int כמו בקוד הישן
      name:       profile.name,
      role:       profile.role,
      project_id: profile.project_id,
      // כל הפרויקטים שהמשתמש חבר בהם (migration 0009). fallback: הפרויקט הראשי בלבד.
      project_ids: Array.isArray(profile.project_ids) && profile.project_ids.length > 0
        ? profile.project_ids.map(Number)
        : (profile.project_id ? [Number(profile.project_id)] : []),
      email:      authUser.email,
    };
    setCurrentUser(user);
    const proj = user.project_id ? projects.find(p => p.id === user.project_id) : projects[0];
    setActiveProject(proj);
    // מנכ"ל מתחיל עם כל הפרויקטים, פעיל/רכז עם הפרויקט שלו
    setFilterProject(user.project_id ?? null);
    return true;
  }

  // שחזור session בעת טעינת האפליקציה + סנכרון logout בין טאבים
  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (active && data?.session?.user) await applyProfile(supabase, data.session.user);
      if (active) setAuthLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' || !session?.user) {
        setCurrentUser(null); setActiveProject(null); setFilterProject(null);
      }
    });

    return () => { active = false; sub?.subscription?.unsubscribe(); };
  }, []);

  async function login(usernameOrEmail, password) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolveEmail(usernameOrEmail),
      password,
    });
    if (error || !data?.user) { setLoginError('שם משתמש או סיסמה שגויים'); return false; }

    // שליפת הפרופיל המקושר ל-Auth (activist_code שומר על תאימות ל-Number(currentUser.id))
    const ok = await applyProfile(supabase, data.user);
    if (!ok) { setLoginError('לא נמצא פרופיל למשתמש'); return false; }

    setLoginError('');
    return true;
  }

  async function logout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    setCurrentUser(null); setActiveProject(null); setFilterProject(null);
  }

  // מעבר פרויקט — מאומת מול חברות בפועל (project_ids). מונע ממשתמש (למשל רכז פרויקט אחד)
  // לעבור לפרויקט שהוא לא חבר בו ולחשוף את נתוניו, גם אם רכיב כלשהו מציע לו את האפשרות.
  function switchProject(projectId) {
    if (projectId === 0) {
      if (currentUser?.role !== 'ceo') return; // "כל הפרויקטים" — מנכ"ל בלבד
      setFilterProject(null);
      return;
    }
    const isMember = currentUser?.role === 'ceo' || (currentUser?.project_ids || []).includes(projectId);
    if (!isMember) return;
    const proj = projects.find(p => p.id === projectId);
    if (proj) {
      setActiveProject(proj);
      setFilterProject(projectId);
    }
  }

  const role = currentUser?.role;
  const MEETING_HOUSE_RESULTS_WHITELIST = []; // מזהי משתמשים עם גישה מיוחדת — להרחבה עתידית
  const can  = {
    seeSensitiveData:       ['activist', 'coord', 'head', 'ceo'].includes(role),
    addContact:             role === 'activist',
    callContact:            role === 'activist',
    seeActivists:           role !== 'activist' && role !== 'finance',
    seePayments:            role === 'finance' || role === 'head' || role === 'ceo' || role === 'coord',
    seeMeetingHouses:       role === 'ceo' || role === 'head' || role === 'coord' || role === 'finance',
    seeMeetingHouseResults: role === 'ceo' || role === 'head' || role === 'coord' || MEETING_HOUSE_RESULTS_WHITELIST.includes(currentUser?.id),
    ownProjectId:           currentUser?.project_id ?? null,
  };

  return (
    <AuthContext.Provider value={{ currentUser, activeProject, filterProject, loginError, authLoading, login, logout, switchProject, can, projects }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
