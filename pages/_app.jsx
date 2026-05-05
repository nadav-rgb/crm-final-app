// pages/_app.jsx
import '../styles/globals.css';
import '../styles/components.css';
import { CrmProvider } from '../lib/CrmStore';
import { AuthProvider, useAuth } from '../lib/AuthStore';
import ReminderSchedulerMount from '../components/ReminderSchedulerMount';
import LoginPage from './login';
import LandingPage from './landing';
import { useRouter } from 'next/router';

function AppShell({ Component, pageProps }) {
  const { currentUser } = useAuth();
  const router = useRouter();

  if (!currentUser) return <LoginPage />;
  if (router.pathname === '/landing') return <LandingPage />;

  return <Component {...pageProps} />;
}

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <CrmProvider>
        <ReminderSchedulerMount />
        <AppShell Component={Component} pageProps={pageProps} />
      </CrmProvider>
    </AuthProvider>
  );
}
