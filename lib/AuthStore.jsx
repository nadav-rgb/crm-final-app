// lib/AuthStore.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import projects from '../data/projects';
import { getSupabaseClient } from './supabaseClient';

const AuthContext = createContext(null);

// מיפוי username → email אמיתי ב-Supabase (חלקם אינם <username>@achdut-crm.test)
const USERNAME_TO_EMAIL = {
  // שמות בעברית לטסטרים
  'נדב':           'nadav@achdut-crm.test',
  'רפאל':          'refaelraiton@achdut-crm.test',
  'מוטי גלעד':     'moti_galed@achdut-crm.test',
  'מוטי שטרלינג':  'moti_sterling@achdut-crm.test',
  'חדווה':         'chedva@achdut-crm.test',
  'קורלנסקי':      'korlansky@achdut-crm.test',
  'מנכ״ל':         'rabbigreenboim@achdut-crm.test',
  // alias באנגלית — כדי לא לשבור כניסה קיימת
  nadav:     'nadav@achdut-crm.test',
  refael:    'refaelraiton@achdut-crm.test',
  moti:      'moti_galed@achdut-crm.test',
  sterling:  'moti_sterling@achdut-crm.test',
  chedva:    'chedva@achdut-crm.test',
  korlansky: 'korlansky@achdut-crm.test',
  ceo:       'rabbigreenboim@achdut-crm.test',
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
      .select('activist_code, name, role, project_id')
      .eq('id', authUser.id)
      .single();
    if (error || !profile) return false;

    const user = {
      id:         Number(profile.activist_code), // נשאר int כמו בקוד הישן
      name:       profile.name,
      role:       profile.role,
      project_id: profile.project_id,
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

  function switchProject(projectId) {
    if (projectId === 0) {
      setFilterProject(null);
      // כשבוחרים "כל הפרויקטים" — משאירים את הפרויקט הפעיל כמות שהוא
    } else {
      const proj = projects.find(p => p.id === projectId);
      if (proj) {
        setActiveProject(proj);
        setFilterProject(projectId);
      }
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
