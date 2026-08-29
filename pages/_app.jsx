import '../styles/globals.css';
import '../styles/components.css';
import { CrmProvider } from '../lib/CrmStore';
import { AuthProvider, useAuth } from '../lib/AuthStore';
import PushRegistrationMount from '../components/PushRegistrationMount';
import MfaEnrollment from '../components/auth/MfaEnrollment';
import LoginPage from './login';
import LandingPage from './landing';
import ResetPasswordPage from './reset-password';
import { useRouter } from 'next/router';

function BusinessApp({ Component, pageProps }) {
  const router = useRouter();
  if (router.pathname === '/landing') return <LandingPage />;
  return (
    <CrmProvider>
      <PushRegistrationMount />
      <Component {...pageProps} />
    </CrmProvider>
  );
}

function AppShell({ Component, pageProps }) {
  const { currentUser, authLoading, requiresMfa, authState } = useAuth();
  if (authLoading) return <div aria-busy="true" aria-label="טוענים את החשבון" style={{ minHeight: '100vh', background: 'var(--color-bg)' }} />;
  if (authState === 'recovery') return <ResetPasswordPage />;
  if (!currentUser) return <LoginPage />;
  if (requiresMfa) return <MfaEnrollment />;
  return <BusinessApp Component={Component} pageProps={pageProps} />;
}

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <AppShell Component={Component} pageProps={pageProps} />
    </AuthProvider>
  );
}
