# CRM Mekarvim — מפרט תכנון להקשחת אבטחה

## סטטוס והחלטה ארכיטקטונית

מסמך זה מקבע את תכנון ה־Security Hardening שאושר ב־27 באוגוסט 2026. היעד הוא מערכת fail-closed שבה הדפדפן אינו גבול אמון, ידיעת מזהה אינה מקנה הרשאה, והגישה לנתונים נאכפת הן בשרת והן ב־PostgreSQL RLS.

הארכיטקטורה שנבחרה היא **BFF מאותו origin מעל Supabase Auth ו־PostgreSQL RLS**:

- הדפדפן מתקשר רק עם נתיבי `/api` של Mekarvim ואינו מקבל JWT של Supabase, service-role key או גישת PostgREST ישירה.
- Supabase Auth נשאר ספק הזהות והסיסמאות. אימות סיסמה, refresh ו־MFA מתבצעים בצד השרת בלבד.
- הדפדפן מחזיק cookie אטום של session, מסוג `HttpOnly`, `Secure`, `SameSite=Lax`, עם קידומת `__Host-`, ללא `Domain` ועם `Path=/`.
- כל פעולת business בשרת משתמשת ב־Supabase client בהקשר המשתמש וב־JWT השרת־צדדי שלו, כך ש־RLS נשאר שכבת אכיפה עצמאית. Service role מוגבל ליצירת session, refresh, append ל־audit, משימות cron מוגדרות ופעולות תחזוקה מפורשות.
- מודל החברות מנורמל ל־`project_memberships`; אין עוד הרשאה המבוססת על מערכי `project_ids` בדפדפן או על `activist_code` שמגיע מגוף הבקשה.

שתי חלופות נדחו: Supabase SSR רגיל, משום שהוא עדיין חושף session token לקוד דפדפן ומאפשר גישת PostgREST ישירה; והחלפת ספק הזהות ב־Auth0/Clerk, משום שהיא מוסיפה ספק ומיגרציה בלי לפתור את בעיית ה־RLS וה־tenant isolation.

## יעדים ומדדי הצלחה

ההקשחה תיחשב מוכנה לביקורת אבטחה רק כאשר מתקיימים יחד:

- אין passwords, user directory, auth token או service credential בקוד או ב־client bundle.
- כל PII ונתון עסקי נטענים דרך API מצומצם־שדות; מערכי demo ו־fallback רגישים אינם משמשים production.
- כל טבלה, view, function ו־bucket רגישים נבדקים מול deny-by-default ו־RLS מפורש לכל פעולת CRUD רלוונטית.
- בדיקות של anonymous, cross-user, cross-project, IDOR/BOLA, mass assignment ו־session misuse נכשלות באופן צפוי.
- שינוי role, חסימת משתמש, logout או expiration מבטלים גישה בפועל.
- MFA ברמת AAL2 נאכף ל־CEO ול־Project Head לפני מידע או mutation רגישים.
- security headers, CSRF, origin checks, rate limiting, validation, error redaction ו־audit trail מאומתים אוטומטית.
- build, כל בדיקות הרגרסיה, בדיקות האינטגרציה וחבילת בדיקות האבטחה עוברים.
- `npm audit` נבחן לאחר upgrades; כל Critical/High שנותר מתועד עם הצדקה, פיצוי ובעלים.
- לא מתבצעים merge ל־main או deployment ל־Production כחלק מהעבודה.

אין טענה ל־“100% secure”. התוצר הוא defense-in-depth עם ראיות והכרעה `READY FOR SECURITY REVIEW` או `NOT READY FOR REAL SENSITIVE DATA`.

## Baseline מאומת לפני שינוי קוד

ה־baseline נלקח ב־branch `security/hardening-p0` ב־worktree מבודד, מ־commit `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`. ה־checkout המקורי נשאר ללא שינוי.

- `npm run verify:interaction-report`: עברו 27 בדיקות.
- `node scripts/verify-payment-order.cjs`: עברו 24 בדיקות.
- `node scripts/verify-month-report.cjs 2026 7`: עבר מול Supabase חי, בקריאה בלבד.
- `node scripts/verify-payroll-xlsx.cjs 2026 7`: עבר מול Supabase חי; קובץ הבדיקה נכתב ל־Temp בלבד.
- `npm run build`: עבר; קיימת אזהרת webpack cache שאינה מפילה build.
- `node scripts/probe-rls.mjs`: שמונה יעדי probe אנונימיים לא החזירו שורות; שבע טבלאות החזירו אפס ו־`activist_directory` נחסם ב־`42501`.
- `npm audit --json`: 16 חולשות — 3 Critical, 10 High ו־3 Moderate. תלויות ישירות מושפעות: `next`, `jspdf`, `@capacitor/assets`, `exceljs`.

ה־probe האנונימי אינו מוכיח בידוד בין משתמשים מחוברים. בדיקות authenticated cross-tenant יתווספו כחלק מהיישום.

## ממצאי האיום המרכזיים

### Critical

- מנגנון ההתחברות הנוכחי מבצע auth בדפדפן, שולח directory של משתמשים לדפדפן ושומר Supabase session ב־localStorage.
- חלק גדול מנתיבי ה־API משתמש ב־service role אחרי בדיקת role כללית בלבד. שינוי IDs או `project_id` מאפשר בחלק מהזרימות BOLA/tenant escape.
- מדיניות RLS קיימת משאירה טבלאות עם `authenticated_all`, ו־`notifications_insert` פתוחה לכל יעד. משתמש מחובר יכול לעקוף את ה־UI ואת ה־API.
- גרסאות `next` ו־`jspdf` הן בעלות advisory ברמת Critical ב־baseline.

### High

- נתיבי meeting houses, tours, reminders, push, reports ו־duplicate-check אינם מאמתים באופן עקבי חברות בפרויקט ובעלות על המשאב.
- PII, היסטוריית קשר, התקדמות דתית ודוחות נשאבים ישירות מהדפדפן באמצעות `select('*')`; חלקם נשמרים ב־localStorage.
- אין MFA, session revocation מלא, CSRF protection, rate limiter מרכזי, validation schema מרכזי או audit trail מאובטח.
- הודעות שגיאה מחזירות לעיתים `error.message` של DB או upstream.
- notifications/push מקבלים תוכן ו־URL לא בטוחים ועלולים לחשוף מידע במסך נעילה או לאפשר ניווט לא מאושר.
- סנכרון Google Sheets מניח sheet ציבורי; cron של feedback מיועד לשלוח PII ל־GitHub issue בריפו ציבורי; Anthropic מקבל טקסטים רגישים ללא צמצום או מגבלת גודל.
- Android מאפשר backup, חושף FileProvider רחב, עלול לחתום release ב־debug ואינו מפעיל minification.

### Medium ו־Low

- חסרים CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ו־`frame-ancestors`; responses מסוימים קיבלו cache ציבורי ו־CORS `*`.
- `.gitignore` אינו מכסה את כל `.env.*`, logs, coverage ו־local artifacts.
- seed/demo מכילים שמות, טלפונים וסיסמאות דוגמה; היסטוריית Git כוללת מחרוזות credential-like. ערכים אינם נרשמים בדוחות.
- `google-services.json` tracked ומכיל Firebase client key; המפתח נחשב public configuration אך חייב restriction בצד Google.
- build output הנוכחי שנבדק אינו מכיל את שמות ה־server secrets, אך יש להפוך זאת לבדיקה קבועה.

## גבולות אמון וזרימת בקשה

1. הדפדפן שולח בקשה same-origin ל־BFF עם session cookie אטום. mutation כולל `Origin` תקין ו־`X-CSRF-Token` הקשור ל־session.
2. שכבת request guard בודקת method, media type, גודל body, origin, CSRF, rate limit ו־session לפני parsing עסקי.
3. שכבת session מאתרת hash של המזהה, בודקת `revoked_at`, absolute expiry, idle expiry, user disablement, `security_version` ו־AAL נדרש.
4. שכבת authorization טוענת identity ו־membership מהשרת. היא אינה מקבלת role, user id, activist id או project authority מהלקוח.
5. validator allowlist בונה command פנימי ומסיר unknown fields. `project_id`, owner, actor, audit fields ו־recipient נגזרים בשרת.
6. repository משתמש ב־Supabase client של המשתמש. RLS מאמת מחדש את אותה גישה במסד.
7. mutation עסקי ו־audit event נכתבים באותה transaction או RPC כאשר נדרשת אטומיות.
8. התגובה עוברת field projection לפי role, מקבלת `Cache-Control: no-store` כאשר היא אישית, ואינה כוללת internal error.

Service role אינו משמש “קיצור דרך” ל־business route רגיל. לכל חריגה יש wrapper ייעודי, allowlist של פעולה, audit event ובדיקה שמוכיחה שאין authority מגוף הבקשה.

## מודל זהות, Session ו־Authentication

### זהויות ושמות משתמש

- `auth.users` הוא מקור האמת לסיסמאות, password reset, email verification ו־MFA.
- כדי לשמר UX של username, טבלה פרטית `auth_identities` ממפה `normalized_username` ל־`auth_user_id` ולזהות ההתחברות. היא אינה חשופה ל־`anon` או `authenticated`.
- login מחזיר אותה הודעה ואותו status עבור username לא קיים, password שגוי ומשתמש חסום, כדי לצמצם enumeration.
- אין רשימת משתמשים, email map או password בדפדפן, ב־seed או ב־JavaScript bundle.

### Session server-side

טבלה פרטית `app_private.auth_sessions` תשמור לפחות:

- hash קריפטוגרפי של session id אקראי ברמת 256 bit;
- `user_id`, `created_at`, `last_seen_at`, absolute expiry ו־idle expiry;
- `revoked_at`, `revoke_reason`, `security_version`, `aal` ו־MFA enrollment state;
- Supabase provider tokens מוצפנים במפתח שרת חיצוני עם key version; tokens גולמיים אינם נשמרים בלוג או בדפדפן;
- hash של CSRF secret ו־metadata מצומצם לזיהוי אירועי abuse.

ה־cookie ייקרא `__Host-mekarvim_session`, יהיה host-only, ויוחלף אחרי login, השלמת MFA, password reset או privilege transition. logout מסמן את ה־session כ־revoked בצד השרת, מבטל refresh מול Supabase ככל שניתן ומוחק את ה־cookie. אין הסתפקות במחיקת React state.

ברירת המחדל תהיה idle expiry של 30 דקות ו־absolute expiry של 12 שעות לבעלי הרשאות גבוהות; עבור Activist/Coordinator ניתן לאפשר עד 8 שעות idle ועד 24 שעות absolute לאחר בדיקת UX. “זכור אותי” אינו נתמך בשלב P0. כל request רגיש מעדכן idle time בקצב מוגבל כדי למנוע write amplification.

`profiles.security_version` ו־`profiles.disabled_at` נבדקים בכל request מאומת. שינוי role/membership/password, חסימת משתמש או אירוע אבטחה מעלים version ומבטלים את כל ה־sessions הישנים. אין session fixation: מזהה שהגיע לפני auth לעולם אינו משודרג ל־session מאומת.

### MFA

- CEO ו־Project Head חייבים Supabase TOTP MFA ו־AAL2 לפני קבלת PII, דוחות, mutations או ניהול הרשאות.
- session ב־AAL1 של role מוגן מקבל רק endpoints של enrollment, challenge, logout ו־status; כל היתר מחזירים שגיאת MFA נדרשת ללא נתונים.
- Coordinator ו־Activist יכולים להירשם ל־MFA; הפעלה חובה עבורם יכולה להתווסף באמצעות policy ללא שינוי מודל הנתונים.
- recovery codes אינם נכתבים ל־application log. שינוי factor, password reset או account recovery מבטלים sessions קיימים ומייצרים audit event.
- אם הגדרת TOTP/AAL2 ב־Supabase אינה זמינה בהרשאות הסביבה, הקוד, ה־migration והבדיקות יוכנו והסטטוס הסופי יישאר blocked עד הפעלת ההגדרה ובדיקת end-to-end.

### Rate limiting לאימות

Rate limit נשמר במאגר משותף ועמיד, לא בזיכרון process. המפתח משלב hash של username מנורמל, IP prefix ו־endpoint:

- login: חמישה ניסיונות ל־15 דקות לכל username+IP, עם backoff ו־generic response;
- password reset: שלושה ניסיונות לשעה לכל identity ו־IP;
- MFA challenge/verify: חמישה ניסיונות ל־10 דקות;
- session refresh: קצב נמוך לכל session ומנעול single-flight;
- enumeration ו־sensitive lookup: מכסה לפי user, project ו־IP.

התגובה אינה מגלה איזה מפתח נחסם. הצלחת login אינה מוחקת מיד את כל היסטוריית ה־IP, כדי למנוע עקיפה. ב־Production יידרש store משותף כגון Upstash/Vercel KV או טבלת Postgres עם RPC אטומי ו־cleanup; fallback in-memory אסור ב־Production.

## מודל RBAC

### תפקידי מערכת

| Role | Scope | PII | פעולות ניהול |
| --- | --- | --- | --- |
| CEO | כל הפרויקטים | כל שדות העסק הנדרשים; סודות auth לעולם לא | CRUD מלא, ניהול memberships/roles, דוחות, audit מצומצם; MFA חובה |
| Project Head (`head`) | פרויקטים שבהם membership פעיל כ־head | PII מלא בפרויקטים שלו | CRUD עסקי וניהול membership מוגבל בתוך הפרויקט; אינו ממנה CEO ואינו חוצה פרויקט; MFA חובה |
| Coordinator (`coord`) | פרויקטים שבהם membership פעיל כ־coord | PII תפעולי מלא בפרויקטים שלו | יצירה, עדכון ושיוך; אין שינוי roles, hard delete, auth או audit |
| Activist | פרויקטים שבהם membership פעיל; rows שהוקצו ל־`auth.uid()` | רק contacts והיסטוריה שהוקצו לו | יצירה ועדכון של קשרים/דיווחים שלו; אין שינוי tenant, owner, role או hard delete |
| Finance | פרויקטים שבהם membership פעיל כ־finance | נתוני תשלום נדרשים ומדדים מצרפיים בלבד | קריאה של payment/expense scope; אין טלפון, notes, היסטוריה דתית, תוכן קשר או שינוי הרשאות |

`finance` נשמר כדי לא לשבור functionality קיים, אך אינו מרחיב את ארבעת תפקידי הליבה. שם role canonical הוא הערך במסד; aliases מהקוד הישן יומרו בשרת ולא יתקבלו מהלקוח.

### חברות בפרויקט

`project_memberships(project_id, user_id, role, status, created_by, created_at, updated_at)` מקבל unique על `(project_id,user_id)`. רק `status='active'` מעניק גישה. CEO הוא global role ב־profile ואינו תלוי במערך project IDs.

הקישור בין זהות Supabase לבין הקוד המספרי הישן יהיה explicit באמצעות `profiles.user_id`/`activist_code`; סמכות ל־contact תעבור ל־`assigned_user_id uuid`. בתקופת migration יישמר activist code לצורכי דוחות בלבד, עם constraint/trigger שמונע חוסר התאמה. בסוף המעבר, numeric ID מהבקשה אינו משמש authorization.

### פעולות עסקיות מדויקות

| משאב | CEO | Project Head | Coordinator | Activist | Finance |
| --- | --- | --- | --- | --- | --- |
| Projects | CRUD | SELECT שלו; UPDATE שדות תפעוליים מוגבלים | SELECT שלו | SELECT שם/metadata נדרש | SELECT שם/metadata נדרש |
| Memberships/Profiles | CRUD עם הגנות anti-self-escalation | SELECT בפרויקט; invite/update Activist/Coordinator בלבד לפי policy | SELECT directory מצומצם | SELECT self בלבד | SELECT directory תשלומים מצומצם |
| Contacts | CRUD בכל פרויקט | CRUD בפרויקט שלו | CRUD תפעולי בפרויקט שלו ללא hard delete | SELECT/INSERT/UPDATE מוקצים בלבד; delete לוגי רק לפי workflow | אין row PII; projections מצרפיים בלבד |
| Interactions | CRUD | CRUD בפרויקט שלו | CRUD בפרויקט שלו | CRUD רק שלו ועל contact מוקצה; delete לפי חלון עסקי | aggregates בלבד |
| Meeting houses/base reports | CRUD | CRUD בפרויקט שלו | CRUD ושיוך בפרויקט שלו | קריאה/דיווח רק על משימות מוקצות | אין גישה |
| Tours | CRUD | CRUD בפרויקט שלו | CRUD ושיוך בפרויקט שלו | קריאת סיור שהוקצה ודיווח שלו | aggregates כספיים נדרשים בלבד |
| Expenses/payments/bonuses | CRUD | קריאת פרויקט ואישור לפי workflow | קריאת מצב תפעולי ללא פרטי שכר שאינם נדרשים | CRUD הוצאה של עצמו וקריאת תשלום שלו | קריאה/עיבוד בפרויקט לפי field projection |
| Notifications/reminders/push | ניהול בכל scope | יצירה ליעד מורשה בפרויקט | יצירה ליעד מורשה בפרויקט | יצירה עצמית דרך workflows בלבד; קריאה/סימון שלו | notifications שלו בלבד |
| Feedback | כל הרשומות; שינוי status | project scope | יצירה וקריאת שלו לפי צורך | יצירה וקריאת שלו | יצירה וקריאת שלו |
| Audit log | SELECT מצונזר ומוגבל | אין גישה ב־P0 | אין גישה | אין גישה | אין גישה |

כל hard delete רגיש מוגבל ל־CEO או ל־RPC תחזוקה מוגדר. פעולות משתמש רגילות מעדיפות soft delete עם actor, reason ו־audit.

## Inventory ו־Field Projection של מידע רגיש

### קבוצות מידע

- **זיהוי וקשר:** שם, טלפון, email, כתובת, יישוב, קהילה, source/referrer ומזהים מקשרים.
- **מידע תפעולי רגיש:** שיוך לפעיל/פרויקט, עומק וסוג קשר, high potential, status, meeting house, next action, reminder ותוכן notification.
- **תוכן אישי רגיש:** notes, interaction outcome/content, participants, feedback message, base/tour reports והיסטוריית קשר.
- **מידע דתי רגיש במיוחד:** mitzvot state/history, התקדמות ומסקנות.
- **מידע פיננסי:** expenses, bonus cancellations, payment config, סכומי שכר ותוצאות payroll.
- **מידע ארגוני/ממשל:** projects, memberships, role, user status, audit events ו־security metadata.
- **מזהי מכשיר/אינטגרציה:** push subscriptions, FCM tokens, IP hash, user-agent מצומצם וקישור external issue.

### כללי projection

- אין יותר `select('*')` בנתיבי production רגישים. לכל use case מוגדר SELECT column allowlist ו־response DTO.
- Activist מקבל identity, phone, operational notes, next action והיסטוריה רק עבור contact שמוקצה לו. הוא אינו מקבל internal membership, שכר של אחרים או contact בלתי מוקצה.
- Coordinator ו־Project Head מקבלים PII רק בפרויקטים שלהם. endpoints של רשימות מחזירים summary; פרטי notes/history נטענים רק ב־detail endpoint מורשה.
- Finance מקבל מזהה עובד, שם נדרש לתשלום, סכומים וסטטוס בלבד; phone, address, notes, religious fields, interaction text ו־contact names אינם נשלחים.
- Audit response משמיט tokens, raw body, phone, notes ו־external payload. actor/target IDs, action, result, project, timestamp ו־correlation ID מספיקים.
- Push lock-screen מציג תוכן כללי בלבד, לדוגמה “יש עדכון חדש במערכת”; PII נטען לאחר פתיחת האפליקציה ואימות session.
- נתוני report/export נוצרים בשרת, מוגנים ב־`no-store`, אינם נשמרים ב־public URL ומקבלים scope זהה למסך.

## תכנון Database ו־RLS

### עקרונות

- RLS מופעל על כל טבלה ב־`public` שמכילה או מקשרת מידע עסקי, עם `FORCE ROW LEVEL SECURITY` היכן שמתאים ועם grant מינימלי.
- כל policy ישנה נבדקת ומוסרת במפורש; policies permissive מצטברות ב־OR ולכן policy רחבה אחת מבטלת בידוד.
- helper functions הן `security definer`, עם `search_path` קבוע, owner ייעודי, `REVOKE EXECUTE FROM PUBLIC` ו־grant רק לתפקידים הנדרשים.
- views הן `security_invoker`; materialized views/exports אינם עוקפים RLS. RPC בודק authorization בתוך ה־transaction.
- `WITH CHECK` מאמת גם tenant וגם owner לאחר UPDATE, כדי למנוע “העברת” row לפרויקט/משתמש אחר.
- `project_id`, `assigned_user_id`, `actor_id`, `recipient_id`, role ו־audit fields נגזרים מ־`auth.uid()` ומה־membership; שדה כזה מהלקוח נדחה ולא רק נדרס בשקט.
- tables פרטיות של session, auth identity, rate limit ו־audit append API נמצאות ב־schema שאינו חשוף ל־PostgREST, עם revoke ל־anon/authenticated.

### מטריצת RLS מתוכננת

| Table / object | RLS | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- | --- |
| `projects` | כן | CEO הכל; אחרים membership פעיל | CEO | CEO; Head שדות allowlist דרך RPC | CEO |
| `project_memberships` | כן | self; CEO; Head project-scope | CEO; Head לתפקידים נמוכים בפרויקט | CEO; Head מוגבל, ללא self-escalation | CEO; Head מוגבל |
| `profiles` | כן | self projection; CEO; directory מצומצם לפי membership | provisioning service בלבד | self fields לא־הרשאתיים; roles דרך RPC מורשה | provisioning service בלבד |
| `auth_identities` | schema פרטי | auth service בלבד | auth service | auth service | auth service |
| `auth_sessions` | schema פרטי | session service בלבד | session service | session service | cleanup service |
| `contacts` | כן | CEO; Head/Coord project; Activist assigned; Finance ללא table access | roles עסקיים, עם tenant/owner נגזרים | אותו scope + `WITH CHECK`; שדות allowlist | CEO בלבד; soft delete לאחרים |
| `interactions` | כן | CEO; Head/Coord project; Activist actor+assigned contact; Finance aggregates RPC | actor נגזר, contact מורשה | אותו actor/scope + immutable tenant/owner | CEO/Head policy; Activist רק workflow מוגבל |
| `base_meeting_reports` | כן | project scope או assigned activist | scope מתאים, server-derived actor/project | scope מתאים + immutable tenant | CEO/Head או soft delete |
| `meeting_houses` | כן | project scope/assignment | CEO/Head/Coord project | CEO/Head/Coord project; Activist דיווח מוקצה בלבד | CEO/Head |
| `meeting_reminders` | כן | recipient/self; managers project scope | workflow service לאחר בדיקת target | recipient status בלבד או manager project | workflow service/manager project |
| `tours` | כן | project scope; Activist רק assigned | CEO/Head/Coord project | CEO/Head/Coord project; assigned report בלבד | CEO/Head project |
| `expenses` | כן | self; CEO/Head/Finance project; Coord summary לפי צורך | self בלבד, project נגזר | self pending או approver workflow | self pending; CEO/Head לפי policy |
| `bonus_cancellations` | כן | self או management/finance project | approver מורשה בלבד | approver מורשה | CEO בלבד |
| `payment_config` | כן | authenticated projection נדרש | CEO בלבד | CEO בלבד | אין delete רגיל |
| `notifications` | כן | recipient בלבד | service/RPC מורשה בלבד | recipient יכול read-state בלבד | recipient expiry cleanup/service |
| `notification_reads` | כן | recipient בלבד | recipient=self | recipient=self | recipient=self |
| `push_subscriptions` | כן | owner בלבד; service לשליחה | owner=self | owner=self | owner=self/service cleanup |
| `fcm_tokens` | כן | owner בלבד; service לשליחה | owner=self | owner=self | owner=self/service cleanup |
| `feedback_reports` | כן | creator; CEO; Head project לפי צורך | actor/project נגזרים | reviewer מורשה או creator fields מוגבלים | CEO או retention job |
| `audit_events` | כן/פרטי | CEO דרך view מצונזר; security service מלא | append RPC/service בלבד | אף משתמש; append-only | retention service בלבד |
| `rate_limit_buckets` | schema פרטי | rate-limit service | RPC אטומי | RPC אטומי | cleanup service |
| `activist_directory` view | security invoker | projection לפי membership/finance use case | לא רלוונטי | לא רלוונטי | לא רלוונטי |
| reporting RPC/views | invoker + בדיקות | role/project-specific projection | לא רלוונטי | לא רלוונטי | לא רלוונטי |

לפני migration יופק inventory חי מ־`pg_class`, `pg_policies`, `information_schema.role_table_grants`, functions, views ו־storage buckets. אובייקט רגיש שלא מופיע במטריצה יקבל deny עד לסיווג, ולא policy רחבה זמנית.

## API/BFF ותיקון IDOR/BOLA

### Contract אחיד

- `/api/auth/*`: login, MFA enrollment/challenge, reset, session status ו־logout בלבד.
- `/api/projects/:projectId/...`: ה־project path הוא filter מבוקש, לא authority. membership נבדק מה־session וה־DB.
- `/api/contacts/:id`, `/api/interactions/:id`, `/api/tours/:id`, `/api/meeting-houses/:id`: ה־repository טוען את המשאב דרך user-scoped query. “לא קיים” ו־“לא מורשה” מוחזרים כ־404 אחיד כאשר disclosure של existence אינו נדרש.
- mutations מקבלות רק שדות editable. IDs של actor, project, owner, recipient ו־role אינם חלק מה־input schema.
- request body עם unknown security-sensitive fields נדחה ב־400; אין mass assignment דרך object spread.
- endpoints קיימים של assign/upsert/update/cancel/delete/notify/schedule/send יעברו ל־guards משותפים ולשאילתות project-scoped. בדיקת role כללית לבדה אינה מספיקה.

### תרחישי BOLA המחייבים חסימה

- Coordinator בפרויקט A שולח tour/contact/meeting house ID של פרויקט B.
- Activist מחליף contact ID לזה של פעיל אחר באותו פרויקט או בפרויקט אחר.
- גוף בקשה כולל `project_id`, `activist_id`, `assigned_user_id`, `recipient_id` או `role` חלופיים.
- משתמש שולח notify/push ליעד שאינו בפרויקט שלו, או URL שאינו internal allowlist.
- reminder מתוזמן עבור meeting/activist שהמבקש אינו מורשה לנהל.
- duplicate endpoint משמש enumeration של טלפון בפרויקט אחר.
- report/export מקבל project ID או date/body שמרחיב scope מעבר ל־membership.

כל אחד מהתרחישים נבדק גם ב־API וגם ישירות מול PostgREST/JWT user fixture כדי להוכיח שה־DB חוסם גם עקיפת BFF.

## Input Validation, XSS ו־Redirects

- יתווסף validator schema מרכזי, עם length, format, enum, numeric range ו־date bounds לכל endpoint.
- מגבלת body גלובלית קטנה, עם חריגים מפורשים ל־upload; `Content-Type` שאינו צפוי נדחה.
- phone/email/username מנורמלים בשרת; normalize אינו מחליף authorization.
- HTML אינו נשמר כאשר נדרש plain text. הצגה נשארת escaped על ידי React; אין `dangerouslySetInnerHTML` לתוכן משתמש. export ו־sheet cells מקבלים הגנה מפני formula injection (`=`, `+`, `-`, `@`).
- URLs של notification ו־redirect הם relative paths מתוך allowlist. `javascript:`, `data:`, protocol-relative ו־external host נדחים.
- קלט ל־Anthropic, GitHub, Sheets ו־push עובר projection, size limit ו־redaction ייעודיים; upstream response אינו מוחזר raw.
- מזהים הם UUID/int בפורמט מדויק; arrays מוגבלים באורך; nested objects מקבלים depth ו־key allowlist.

## CSRF, CORS ו־Caching

- כל mutation שמסתמך על cookie דורש method מתאים, `Origin` התואם ל־allowlist exact, ו־`X-CSRF-Token` session-bound. ב־Production, request בלי `Origin` נדחה למעט cron machine-authenticated מוגדר.
- CSRF token נמסר ב־session bootstrap ונשמר בזיכרון האפליקציה בלבד; הוא מסתובב עם session rotation ואינו reusable בין sessions.
- CORS אינו מוסיף `Access-Control-Allow-Origin: *`. ברירת המחדל היא same-origin ללא CORS; origins נוספים דורשים allowlist, credentials policy ו־`Vary: Origin`.
- OPTIONS אינו חושף methods/headers מעבר לנדרש.
- responses עם identity, PII, reports או errors מאומתים מקבלים `Cache-Control: no-store, private`; CDN אינו cache של 401/403/404 פרסונליים.

## Security Headers ו־CSP

headers יוגדרו ב־Next/Vercel וייבדקו הן unit/integration והן מול deployment מאושר:

- CSP nonce-based ללא `unsafe-eval`; `script-src` מצומצם ל־`'self'` ול־nonce. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` ב־Production.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` רק לאחר אימות שכל subdomain הוא HTTPS.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin` או מחמיר יותר לאחר בדיקת integrations.
- `Permissions-Policy` משבית camera, geolocation, payment ויכולות שאינן בשימוש; microphone פתוח ל־self רק במסך speech recognition שנבדק.
- `X-Frame-Options: DENY` כהגנת legacy בנוסף ל־`frame-ancestors 'none'`.
- production responses לא חושפים framework headers מיותרים.

ה־CSP תיבנה תוך inventory של Supabase, Vercel, fonts, push ו־Capacitor, ולא באמצעות wildcard. violation reporting יופעל ליעד מאובטח ללא PII אם configuration זמין.

## Audit Trail ו־Error Handling

### Audit

`audit_events` הוא append-only וכולל: event id, timestamp, actor user id, effective role, project id, action, resource type/id, result, reason code, correlation id, session id hash prefix מאובטח ו־metadata allowlist.

אירועי חובה: login success/failure, MFA enrollment/challenge failure, logout/revocation, password reset, contact create/update/soft-delete, interaction create/update/delete, assignment, role/membership/project change, report/export, sensitive notification, external sync, blocked authorization, rate-limit trigger ו־admin maintenance.

אין audit של password, token, full request, notes, phone או payload חיצוני. משתמש רגיל אינו יכול INSERT/UPDATE/DELETE audit ישירות. פעולת business רגישה ו־audit יתבצעו באותה transaction/RPC כאשר אובדן audit אינו מקובל.

### Errors

- response ציבורי משתמש ב־stable code, הודעה קצרה ו־correlation id; אין stack, SQL, Supabase message, path, secret או upstream body.
- לוג שרת מובנה מכיל context מינימלי ו־redacted. authorization denial נרשם בלי לחשוף את הרשומה שנחסמה.
- auth errors generic; resource existence מוסתר ב־404 כאשר מתאים; malformed input הוא 400, unauthenticated הוא 401, authenticated-but-disallowed הוא 403 רק כאשר עצם המשאב אינו סוד.
- production source maps ו־logging נבדקים כדי למנוע client leakage.

## Secrets ו־Repository Hygiene

- `.gitignore` יורחב עבור `.env`, `.env.*` עם חריג template בטוח, `.next`, `coverage`, logs, local config, generated reports, caches, signing material ו־mobile secrets שאינם public config.
- tracked artifacts נבדקים באמצעות `git ls-files`; מקור נחוץ אינו נמחק. build/cache tracked יוסר מה־index באופן recoverable.
- secret scan מכסה current tree, tracked files, Git history, generated `.next/static` ו־source maps. הדוח מציין type/location/rotation בלבד ואינו מדפיס ערך.
- credential-like values שנמצאו בהיסטוריה ובקוד demo מחייבים rotation audit. rewrite של Git history לא יבוצע בלי תיאום מפורש, משום שהוא destructive לכל collaborators.
- Firebase client config יכול להישאר client-side רק לאחר API/application restriction ב־Google; signing keys, VAPID private key, Supabase secret, Anthropic key, cron secret ו־session encryption key נשארים environment-only.
- יתווסף `.env.example` עם שמות משתנים והסבר, ללא ערכים אמיתיים. startup validation יבדיל server-only מ־`NEXT_PUBLIC_*` וייכשל סגור ב־Production.

## Dependencies ו־Supply Chain

- `next` ישודרג בחריגת major מאושרת ל־`16.3.3`, תוך שמירת Pages Router ו־React/ReactDOM `18.3.1`. סקריפטי dev/build נשארים במפורש על Webpack (`next dev --webpack`, `next build --webpack`), ו־Node מקבל floor של `>=20.9.0`. השדרוג מחייב PostCSS `>=8.5.23`, build מלא, inventory של כל 32 מסלולי הדפים ו־56 מסלולי ה־API, בדיקות auth/session/CSP/HTTP, bundle/secret scans ו־Capacitor/Android regression. אזהרת deprecation לבדה אינה מאשרת המרת `middleware.js` ל־`proxy.js`, ושינוי runtime ב־middleware, `_app`, `_document`, API/auth או CSP מחייב עצירה ואישור נפרד.
- `jspdf` ישודרג בחריגת major מאושרת ל־`4.2.1`, משום שאין תיקון מלא ב־3.x ל־Critical/High העדכניים. `jspdf-autotable` נשאר pinned ל־`5.0.8`, שתומך ב־jsPDF 4. השדרוג מחייב בדיקות Node/browser, PDF עברי, Assistant font embedding, RTL, ספרות ופיסוק, A3 landscape, AutoTable רב־עמודים, repeated headers, `rowPageBreak: 'avoid'`, שלמות שורות ובדיקת render חזותית. שינוי runtime ב־PDF generator אינו מאושר אוטומטית ונדרש לעצור לפניו אם מתגלה incompatibility.
- `exceljs`, `@capacitor/assets` והתלויות הטרנזיטיביות יטופלו לפי advisory ו־fix path. dependency ללא fix תקבל הסרה/החלפה, isolation או blocker מתועד.
- lockfile הוא מקור מחייב; ההתקנה ב־CI משתמשת ב־`npm ci`.
- install scripts ו־new transitive packages נבדקים; upgrades מחולקים לקבוצות קטנות כדי לייחס regression.
- היעד הוא אפס Critical ואפס High. חריגה משאירה verdict כ־not ready, אלא אם advisory לא־reachable הוכח ונחתם לביקורת חיצונית; גם אז אינו מכונה “secure”.

## אינטגרציות חיצוניות ו־Mobile

### Anthropic

AI summary הוא opt-in, role/project-scoped, עם projection ו־redaction לפני שליחה, מגבלת תווים, timeout, rate limit ו־no raw error. UI מציג שנשלח מידע לספק חיצוני. אין שליחת phone, address, IDs, tokens או full history שלא נדרש.

### Google Sheets

הסתמכות על “anyone with link” מוסרת. המקור עובר לחשבון שירות/Google API עם sheet פרטי ו־allowlist של spreadsheet/range. אם credentials אינם זמינים, הסנכרון מושבת fail-closed ומסומן blocker; אין fallback ל־CSV ציבורי.

### GitHub feedback

PII אינו נשלח ל־issue ציבורי. ברירת המחדל היא ביטול האינטגרציה או שליחת event מצונזר לריפו פרטי מאושר. לפני הפעלה יש לאמת visibility, retention ו־token scope. חוסר configuration משאיר את cron כבוי.

### Push

payload lock-screen כללי; deep link relative/allowlisted; token ownership נאכף; send endpoint גוזר recipient מתוך resource מורשה. unsubscribe/cleanup ו־token rotation נבדקים.

### Android/Capacitor

- `allowBackup=false` עבור production או backup rules שמוציאים auth/PII במפורש.
- FileProvider מצטמצם ל־cache/files subdirectory ייעודי, לא `<external-path path=".">`.
- release build נכשל אם release keystore חסר; אין fallback ל־debug signing.
- minify/resource shrinking מופעלים לאחר regression, ו־network security config אוסר cleartext.
- WebView storage/logout, screenshots/recents למסכים רגישים ו־deep links נבדקים; tokens אינם מועתקים ל־native logs.

## תכנית Migration ו־Compatibility

המעבר מתבצע בשלבים בטוחים, אך אין שימוש אמיתי ב־PII עד השלמת P0:

1. להוסיף infrastructure של tests, schemas, migrations idempotent ו־inventory checks בלי להפעיל גישה חדשה.
2. ליצור memberships, private session/audit/rate structures ו־user identity mapping; לבצע backfill מאומת ו־constraints.
3. להוסיף BFF auth/session/MFA ו־API guards מאחורי feature flag server-side; sessions ישנים אינם נחשבים תקפים.
4. להעביר use cases מ־Supabase browser calls ל־BFF DTOs, מסך אחרי מסך, תוך regression של UX.
5. להקשיח RLS/grants ולהפעיל tests עם fixtures של שני projects וכל roles לפני הפעלת path החדש.
6. להסיר client Supabase data/auth, demo credentials, localStorage PII ו־permissive policies.
7. להקשיח integrations, headers, mobile ו־dependencies; להריץ adversarial suite מלא.

מיגרציות DB ייכתבו כרצף forward/verification/rollback. לפי מצב הריפו, DDL ל־Supabase דורש הפעלה ידנית ב־SQL Editor על ידי בעל הפרויקט; לכן העבודה תייצר קובצי migration ופקודות verification, אך לא תטען שה־DB החי הוקשח לפני שהמשתמש הפעיל אותם והבדיקות החיות עברו.

## בדיקות אבטחה וראיות

חבילת הבדיקות תכלול fixtures עם שני פרויקטים, שני Activists בכל פרויקט, Coordinator, שני Project Heads, CEO, Finance, משתמש disabled ו־sessions במצבי AAL/expiry שונים. לפחות 25 דרישות המשתמש יכוסו, ובנוסף:

- direct PostgREST עם JWT לכל role מול כל טבלה רגישה;
- `WITH CHECK` על שינוי tenant/owner לאחר UPDATE;
- enumeration parity של login, reset ו־duplicate lookup;
- CSRF ללא token, token של session אחר, Origin זר ו־method/content-type שגויים;
- MFA AAL1 מול route מוגן ו־AAL2 מול אותו route;
- session fixation, replay אחרי logout, refresh race, user disable ו־security-version change;
- notification recipient spoofing, unsafe deep link ו־push PII projection;
- stored/reflected XSS, spreadsheet formula injection ו־oversized/nested payload;
- audit append-only, redaction ואיסור SELECT למשתמשים לא מורשים;
- client bundle scan ל־service key names/values, passwords, user directory ו־Supabase tokens;
- headers/CSP/cache/CORS על success, 401, 403, 404 ו־500;
- external integration disabled/fail-closed ללא config;
- Android manifest, provider path ו־release signing assertions.

בדיקות adversarial ירוצו מחוץ ל־UI באמצעות requests מזויפים, IDs של tenant אחר, role fields, URLs זדוניים ו־sessions פגומים. כל negative test יתעד actor, request class, שכבת החסימה וה־status הצפוי, ללא PII.

ה־regression הסופי כולל `npm ci`, build, lint אם יתווסף, כל 51 בדיקות ה־baseline, שתי בדיקות האינטגרציה הקיימות, חבילת האבטחה, RLS integration מול סביבת בדיקה, secret scan, client-bundle scan ו־`npm audit`.

## Rollback

- Git rollback הוא revert של commits ב־branch בלבד; אין merge ל־main במסגרת העבודה.
- כל migration כולל SQL הפוך או הוראות restore מדויקות. migrations שמוחקות policy ישנה מתעדות snapshot, אך rollback אינו מחזיר policy permissive בלי אישור סיכון מפורש.
- feature flag מאפשר להשבית BFF path חדש בסביבת staging; ב־Production אין fallback ל־client-only auth או ל־RLS רחב.
- לפני backfill/constraint נלקח backup DB מאומת. שינויי auth/session מבטלים sessions ודורשים login מחדש במקום להמיר token לא בטוח.
- rollback של integration מחזיר אותה למצב disabled, לא למקור ציבורי או payload עם PII.

## Blockers חיצוניים צפויים

- הפעלת migrations ו־verification SQL ב־Supabase דורשת גישת SQL Editor/connection שאינה קיימת ב־repo.
- הפעלת TOTP MFA, redirect URLs, email reset ו־Auth settings דורשת Supabase Dashboard.
- rate limiting משותף דורש בחירה ו־credentials של KV או אישור לטבלת Postgres/RPC.
- headers חיים ו־CSP דורשים deployment ל־staging כדי לאמת בפועל; Production deployment אסור ללא אישור.
- Google Sheet פרטי דורש service account והרשאת sheet; GitHub feedback דורש repo פרטי/token מצומצם או ביטול.
- rotation של credentials אמיתיים והגבלת Firebase key מתבצעות בקונסולות הספקים.
- ניקוי Git history, אם יידרש, דורש תיאום מפורש ו־force push מתוכנן; הוא אינו חלק אוטומטי מהעבודה.

Blocker חיצוני אינו גורם להמצאת secret או להחלשת policy. עד לסגירתו היכולת המתאימה מושבתת, וה־verdict נשאר `NOT READY FOR REAL SENSITIVE DATA` אם הוא נוגע לבקרת P0.

## תוצר סופי

בסיום ייווצר `SECURITY_HARDENING_REPORT.md` עם Executive Summary, findings לפי severity, changes וקבצים, מודל auth/RBAC, מטריצת RLS חיה לכל אובייקט, פקודות ומספרי בדיקות, negative evidence, dependency audit, secret findings ללא ערכים, risks, blockers, rollback ו־verdict יחיד.

הסיכום למשתמש יכלול branch, commit, מספר בדיקות כולל, מספר security tests, תוצאת `npm audit`, מספר טבלאות עם RLS, Critical/High שנותרו, blockers ו־verdict. לאחר מכן העבודה תיעצר ללא merge וללא deployment.
