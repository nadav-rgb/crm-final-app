# מעטפת Capacitor (אנדרואיד) — מקרבים

האפליקציה היא **מעטפת OTA**: Capacitor טוען את האתר החי מ-Vercel (`server.url`).
**עדכון תוכן = `git push` ל-main** → Vercel מתעדכן → האפליקציה מתעדכנת אוטומטית.
**שינוי נייטיב** (אייקון/הרשאות/plugins/חתימה) דורש **בנייה והפצה מחדש של APK**.

## הגדרה
- `capacitor.config.json` — `appId: com.achdutyehudit.crm`, `appName: מקרבים`, `server.url: https://crm-final-app.vercel.app/`.
- **תיקיית `android/` נשמרת בגיט** (מ-2026-06-25) כדי לשמר התאמות נייטיב. רק סודות ותוצרים מוחרגים ב-`.gitignore` (build/, .gradle/, local.properties, keystore.properties, *.jks, service-account).
- minSdk 24, target/compile 36.

## אייקון ו-splash
- מקור: `Icon CRM Mekarvim.png` (איור הארגון). קובצי מקור מעובדים ב-`assets/` (icon-foreground=חיתוך-פנים, splash=איור מלא על רקע #3a249b).
- ייצור מחדש: `npx capacitor-assets generate --android --iconBackgroundColor '#3a249b' --splashBackgroundColor '#3a249b'`.

## Push נייטיב (FCM)
- Firebase project `crm-mekarvim`, app `com.achdutyehudit.crm`. `android/app/google-services.json` בגיט (לא סוד).
- קליינט: `lib/nativePush.js` (רושם FCM token) נקרא מ-`base-meetings.jsx` לצד ה-web-push.
- שרת: `lib/fcmAdmin.js` שולח FCM HTTP v1; `api/push/send.js` ו-cron שולחים web-push **וגם** FCM.
- **דורש env `FCM_SERVICE_ACCOUNT`** ב-Vercel (JSON של service account). בלעדיו — FCM הוא no-op בטוח (web-push ממשיך לעבוד).
- **דורש טבלת `fcm_tokens`** — הרץ `migrations/0002_fcm_tokens.sql` ב-Supabase.

## מיקרופון (STT)
- `components/VoiceInput.jsx`: בדפדפן=Web Speech API; באפליקציה=`@capacitor-community/speech-recognition` נייטיב (he-IL). Web Speech API לא נתמך ב-WebView — לכן המסלול הנייטיב.

## בנייה
```bash
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease   # debug: assembleDebug
# פלט: android/app/build/outputs/apk/release/app-release.apk
```
- חתימת release דרך `android/keystore.properties` (gitignored). ה-keystore והסיסמאות ב-`C:/Users/LENOVO/keystores/` (מחוץ לריפו).
- **שמור על ה-keystore!** אובדנו = אי-יכולת לעדכן את האפליקציה תחת אותה חתימה.

## התקנה למכשיר (ידני בלבד — אין הפצה אוטומטית)
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## בדיקות לאחר התקנה (דורש מכשיר)
- טעינה + התחברות + דשבורד.
- מיקרופון: הקלטה קולית בדיווח (הרשאה נייטיב).
- Push: שיבוץ פעיל → FCM מגיע למכשיר.
