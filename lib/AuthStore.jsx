import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createApiClient } from './security/api-client.mjs';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [filterProject, setFilterProject] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [authState, setAuthState] = useState(null);
  const [mfaFactors, setMfaFactors] = useState([]);
  const csrfRef = useRef(null);
  const clientRef = useRef(null);

  function api() {
    if (typeof window === 'undefined') throw new Error('Browser API is unavailable');
    if (!clientRef.current) {
      clientRef.current = createApiClient({
        origin: window.location.origin,
        getCsrfToken: () => csrfRef.current,
      });
    }
    return clientRef.current;
  }

  function clearAuthState() {
    csrfRef.current = null;
    setCurrentUser(null);
    setProjects([]);
    setActiveProject(null);
    setFilterProject(null);
    setRequiresMfa(false);
    setAuthState(null);
    setMfaFactors([]);
  }

  function applyAuthResult(result) {
    csrfRef.current = result.csrfToken ?? csrfRef.current;
    const authorizedProjects = Array.isArray(result.projects) ? result.projects : [];
    setProjects(authorizedProjects);
    setCurrentUser(result.user ?? null);
    setAuthState(result.authState ?? null);
    setRequiresMfa(result.authState === 'mfa_required');
    setMfaFactors(Array.isArray(result.mfaFactors) ? result.mfaFactors : []);
    const initialProjectId = result.user?.project_id ?? authorizedProjects[0]?.id ?? null;
    setActiveProject(authorizedProjects.find((project) => project.id === initialProjectId) ?? null);
    setFilterProject(result.user?.role === 'ceo' ? null : initialProjectId);
  }

  useEffect(() => {
    let active = true;
    api()('/api/auth/session', { method: 'GET' })
      .then((result) => { if (active) applyAuthResult(result); })
      .catch(() => { if (active) clearAuthState(); })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  async function login(username, password) {
    try {
      const result = await api()('/api/auth/login', {
        method: 'POST', body: { username, password }, csrf: false,
      });
      applyAuthResult(result);
      setLoginError('');
      return true;
    } catch {
      setLoginError('שם המשתמש או הסיסמה לא נכונים. נסו שוב.');
      return false;
    }
  }

  async function logout() {
    await api()('/api/auth/logout', { method: 'POST', body: {} });
    clearAuthState();
  }

  const enrollMfa = () => api()('/api/auth/mfa/enroll', { method: 'POST', body: {} });
  const challengeMfa = (factorId) => api()('/api/auth/mfa/challenge', { method: 'POST', body: { factorId } });

  async function verifyMfa(input) {
    const result = await api()('/api/auth/mfa/verify', { method: 'POST', body: input });
    applyAuthResult({ ...result, user: currentUser, projects });
    return result;
  }

  const requestPasswordReset = (username) => api()('/api/auth/password-reset/request', {
    method: 'POST', body: { username }, csrf: false,
  });

  const apiFetch = useCallback((path, options) => api()(path, options), []);

  async function completePasswordReset(password) {
    const result = await api()('/api/auth/password-reset/complete', {
      method: 'POST', body: { password },
    });
    clearAuthState();
    return result;
  }

  function switchProject(projectId) {
    if (projectId === 0) {
      if (currentUser?.role !== 'ceo') return;
      setFilterProject(null);
      return;
    }
    const project = projects.find((candidate) => Number(candidate.id) === Number(projectId));
    if (!project) return;
    setActiveProject(project);
    setFilterProject(Number(project.id));
  }

  const role = currentUser?.role;
  const can = {
    seeSensitiveData: ['activist', 'coord', 'head', 'ceo'].includes(role),
    addContact: role === 'activist',
    callContact: role === 'activist',
    seeActivists: role !== 'activist' && role !== 'finance',
    seePayments: ['finance', 'head', 'ceo'].includes(role),
    seeMeetingHouses: ['ceo', 'head', 'coord', 'finance'].includes(role),
    seeMeetingHouseResults: ['ceo', 'head', 'coord'].includes(role),
    ownProjectId: currentUser?.project_id ?? null,
  };

  return (
    <AuthContext.Provider value={{
      currentUser, projects, activeProject, filterProject, loginError, authLoading,
      requiresMfa, authState, login, logout, enrollMfa, challengeMfa, verifyMfa,
      mfaFactors, requestPasswordReset, completePasswordReset, switchProject, can,
      apiFetch,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
