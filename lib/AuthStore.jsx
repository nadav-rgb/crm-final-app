// lib/AuthStore.jsx
import { createContext, useContext, useState } from 'react';
import users    from '../data/users';
import projects from '../data/projects';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser,    setCurrentUser]    = useState(null);
  const [activeProject,  setActiveProject]  = useState(null);
  const [filterProject,  setFilterProject]  = useState(null); // null = כל הפרויקטים
  const [loginError,     setLoginError]     = useState('');

  function login(username, password) {
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) { setLoginError('שם משתמש או סיסמה שגויים'); return false; }
    setLoginError('');
    setCurrentUser(user);
    const proj = user.project_id ? projects.find(p => p.id === user.project_id) : projects[0];
    setActiveProject(proj);
    // מנכ"ל מתחיל עם כל הפרויקטים, פעיל/רכז עם הפרויקט שלו
    setFilterProject(user.project_id ?? null);
    return true;
  }

  function logout() { setCurrentUser(null); setActiveProject(null); setFilterProject(null); }

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
  const can  = {
    seeSensitiveData: ['activist', 'coord', 'head', 'ceo'].includes(role),
    addContact:       role === 'activist',
    callContact:      role === 'activist',
    seeActivists:     role !== 'activist' && role !== 'finance',
    seePayments:      role === 'finance' || role === 'head' || role === 'ceo',
    seeMeetingHouses: role === 'ceo' || ((role === 'head' || role === 'finance') && currentUser?.project_id === 2),
    ownProjectId:     currentUser?.project_id ?? null,
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
