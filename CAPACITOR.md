# מעטפת Capacitor (אנדרואיד) — מקרבים

האפליקציה היא **מעטפת OTA**: Capacitor טוען את האתר החי מ-Vercel (`server.url`).
**עדכון = `git push` ל-main** → Vercel מתעדכן → האפליקציה מתעדכנת אוטומטית, בלי APK/USB חדש.

## הגדרה
- `capacitor.config.json` — `appId: com.achdutyehudit.crm`, `appName: מקרבים`, `server.url: https://crm-final-app.vercel.app/`.
- תיקיית `android/` ב-`.gitignore` — נוצרת מחדש ולא נשמרת בגיט.

## שחזור הפלטפורמה (אחרי clone נקי)
```bash
npm install
npx cap add android
npx cap sync android
```

## בניית APK
דורש Android SDK + JBR (ה-JBR שמגיע עם Android Studio, כמו בפרויקטים insurance-leads/family-app).
```bash
cd android
./gradlew assembleDebug
# פלט: android/app/build/outputs/apk/debug/app-debug.apk
```
אם gradle לא מוצא JDK — הצבע אליו, למשל:
`./gradlew assembleDebug -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"`

## התקנה למכשיר (ידני בלבד — אין הפצה אוטומטית)
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## בדיקה חשובה לאחר התקנה
- האפליקציה נטענת ומציגה את האתר החי + התחברות עובדת.
- **B3 (הערת בודק):** הקלדה במיקרופון — לבדוק אם הרשאת המיקרופון הנייטיב פותרת את שגיאת ההרשאה שדווחה בדפדפן.
