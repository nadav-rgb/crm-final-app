// components/PushRegistrationMount.jsx — רישום push גלובלי לכל משתמש מחובר.
// עד עכשיו הרישום קרה רק בעמוד base-meetings — פעיל שלא נכנס לשם מעולם לא נרשם
// (fcm_tokens/push_subscriptions נשארו ריקים ואף תזכורת לא הגיעה למכשיר).
// כאן: ברגע שיש currentUser — נרשמים (web-push בדפדפן, FCM באפליקציה). שתי הפונקציות אידמפוטנטיות.
import { useEffect } from 'react';
import { useAuth } from '../lib/AuthStore';
import { registerPushSubscription } from '../lib/pushClient';
import { initNativePush } from '../lib/nativePush';

export default function PushRegistrationMount() {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser?.id) return;
    registerPushSubscription(String(currentUser.id));
    initNativePush(String(currentUser.id));
  }, [currentUser?.id]);

  return null;
}
