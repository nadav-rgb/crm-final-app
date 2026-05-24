// lib/AuthStore.jsx
import { createContext, useContext, useState } from 'react';
import projects from '../data/projects';
import { getSupabaseClient } from './supabaseClient';

const AuthContext = createContext(null);

// מיפוי username → email אמיתי ב-Supabase (חלקם אינם <username>@achdut-crm.test)
const USERNAME_TO_EMAIL = {
  greenboim:     'rabbigreenboim@achdut-crm.test',
  korlansky:     'korlansky@achdut-crm.test',
  nadav:         'nadav@achdut-crm.test',
  refael:        'refaelraiton@achdut-crm.test',
  moti_gilad:    'moti_galed@achdut-crm.test',
  moti_sterling: 'moti_sterling@achdut-crm.test',
  chedva:        'chedva@achdut-crm.test',
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

  async function login(usernameOrEmail, password) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolveEmail(usernameOrEmail),
      password,
    });
    if (error || !data?.user) { setLoginError('שם משתמש או סיסמה שגויים'); return false; }

    // שליפת הפרופיל המקושר ל-Auth (activist_code שומר על תאימות ל-Number(currentUser.id))
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('activist_code, name, role, project_id')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profile) { setLoginError('לא נמצא פרופיל למשתמש'); return false; }

    const user = {
      id:         Number(profile.activist_code), // נשאר int כמו בקוד הישן
      name:       profile.name,
      role:       profile.role,
      project_id: profile.project_id,
      email:      data.user.email,
    };

    setLoginError('');
    setCurrentUser(user);
    const proj = user.project_id ? projects.find(p => p.id === user.project_id) : projects[0];
    setActiveProject(proj);
    // מנכ"ל מתחיל עם כל הפרויקטים, פעיל/רכז עם הפרויקט שלו
    setFilterProject(user.project_id ?? null);
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
    <AuthContext.Provider value={{ currentUser, activeProject, filterProject, loginError, login, logout, switchProject, can, projects }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
