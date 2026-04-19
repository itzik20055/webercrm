# Weber Leads

מערכת לידים אישית לעונה של Weber Tours — נופש כשר באלפים האוסטריים, סנט אנטון.

PWA לטלפון. עברית RTL. כוללת ניהול לידים, היסטוריית שיחות, פולואפים עם push notifications, ו-3 אזורי זמן (חרדים ישראלים/אמריקאים/אירופאים).

## הוראות הקמה

### 1. חשבונות (חינם)

- **GitHub** — https://github.com/signup
- **Vercel** — https://vercel.com/signup (Sign in with GitHub)
- **Neon** — דרך Vercel Marketplace אחרי יצירת הפרויקט (ראה למטה)

### 2. דחיפה ל-GitHub

```bash
# ב-C:\Users\itzik\weber
git add .
git commit -m "Initial Weber Leads"
gh repo create weber-leads --private --source=. --remote=origin --push
# או ידנית: צור repo ב-github.com, אחר כך:
# git remote add origin https://github.com/USERNAME/weber-leads.git
# git push -u origin main
```

### 3. חיבור ל-Vercel + Neon

1. לך ל-https://vercel.com/new
2. ייבא את ה-repo `weber-leads` מ-GitHub
3. **לפני שתפרוס**, לך ל-Storage → Add Database → **Neon Postgres**
4. בחר תוכנית חינם (500MB), קשר לפרויקט. Vercel יוסיף `DATABASE_URL` אוטומטית.
5. לחץ Deploy. הפריסה הראשונה תיכשל כי חסרים עוד env vars — זה בסדר.

### 4. הוספת משתני סביבה

ב-Vercel → Project Settings → Environment Variables, הוסף:

| משתנה | ערך | לאיזה Environment |
|-------|------|-------------------|
| `APP_PASSWORD` | סיסמה ארוכה (16+ תווים) | All |
| `SESSION_SECRET` | מחרוזת אקראית 32+ תווים | All |
| `CRON_SECRET` | מחרוזת אקראית | Production |
| `VAPID_SUBJECT` | `mailto:itzik20055@gmail.com` | All |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | (ראה צעד 5) | All |
| `VAPID_PRIVATE_KEY` | (ראה צעד 5) | All |

ליצירת מחרוזות אקראיות ב-bash:
```bash
openssl rand -base64 32
```

### 5. יצירת מפתחות VAPID (להתראות Push)

מקומית בפרויקט:
```bash
npm run vapid:generate
```
זה ידפיס שני מפתחות. שים אותם ב-Vercel.

### 6. הרצת migrations במסד

קח את ה-`DATABASE_URL` של Neon מ-Vercel → Storage → .env.local, שמור בקובץ `.env.local` מקומי, ואז:

```bash
npm run db:migrate
```

### 7. פריסה מחדש

ב-Vercel → Deployments → לחץ Redeploy על הפריסה האחרונה.

### 8. התקנה בטלפון

1. פתח את ה-URL (למשל `https://weber-leads.vercel.app`) בספארי iOS או Chrome אנדרואיד.
2. הזן את הסיסמה.
3. iOS: Share → Add to Home Screen. אנדרואיד: ⋮ → Install app.
4. פתח מהמסך הבית.
5. לך להגדרות → "הפעל התראות פולואפ".

## פיתוח מקומי

```bash
cp .env.example .env.local
# ערוך .env.local עם הערכים שלך
npm run db:migrate
npm run dev
```

פתח http://localhost:3000

### פקודות שימושיות

| פקודה | פעולה |
|-------|-------|
| `npm run dev` | שרת פיתוח |
| `npm run build` | בניית פרודקשן |
| `npm run db:generate` | צור migration חדש מהשינויים בסכמה |
| `npm run db:migrate` | הפעל migrations על המסד |
| `npm run db:push` | פוש סכמה ישירות (פיתוח בלבד) |
| `npm run db:studio` | UI לבחינת המסד |
| `npm run vapid:generate` | צור מפתחות VAPID חדשים |

## ארכיטקטורה

- **Next.js 16** App Router — PWA, RTL
- **Drizzle ORM** + **Neon Postgres** — מסד נתונים serverless
- **iron-session** — אימות פשוט בסיסמה אחת
- **web-push** + **Vercel Cron** — תזכורות פולואפ
- **shadcn/ui** + **Tailwind v4** — UI

### מבנה תיקיות

```
app/
  (app)/          — מסכים שדורשים אימות
    page.tsx        דאשבורד
    leads/          ניהול לידים
    followups/      רשימת פולואפים
    settings/       הגדרות + push
  (auth)/login    כניסה
  api/            push, cron, auth
db/             סכמה + migrations
lib/            anonymize, push, session, format
components/     UI components + shadcn
public/         manifest, sw, icons
proxy.ts        Next.js proxy (אימות + cron auth)
```

## פרטיות

- כל קוד פועל על Vercel/Neon — שום שירות צד שלישי אחר.
- אין אינטגרציית AI מופעלת ב-MVP. יתווסף ב-V2 עם **שכבת אנונימיזציה אוטומטית** (ראה `lib/anonymize.ts`) ו-**Vercel AI Gateway Zero Data Retention**.
- כל קריאות AI ייכתבו ל-`ai_audit_log` עם הגרסה המאונונמת בלבד.

## שלבים הבאים (V2/V3)

ראה `C:\Users\itzik\.claude\plans\lively-spinning-popcorn.md`
