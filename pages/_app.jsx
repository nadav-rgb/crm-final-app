// pages/_app.jsx
import '../styles/globals.css';
import '../styles/components.css';
import { CrmProvider } from '../lib/CrmStore';
import { AuthProvider, useAuth } from '../lib/AuthStore';
import ReminderSchedulerMount from '../components/ReminderSchedulerMount';
import PushRegistrationMount from '../components/PushRegistrationMount';
import LoginPage from './login';
import LandingPage from './landing';
import { useRouter } from 'next/router';

function AppShell({ Component, pageProps }) {
  const { currentUser, authLoading } = useAuth();
  const router = useRouter();

  if (authLoading) return null; // ממתינים לשחזור session — מונע הבהוב של מסך login ברענון
  if (!currentUser) return <LoginPage />;
  if (router.pathname === '/landing') return <LandingPage />;

  return <Component {...pageProps} />;
}

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <CrmProvider>
        <ReminderSchedulerMount />
        <PushRegistrationMount />
        <AppShell Component={Component} pageProps={pageProps} />
      </CrmProvider>
    </AuthProvider>
  );
}
