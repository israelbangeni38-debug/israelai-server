# IsraelAi — Setup Guide
## Stack: Node.js + SQLite (server) · Kotlin/Jetpack Compose (Android)

---

## Project Layout

```
IsraelAi/
├── server/
│   ├── index.js                  ← Express entry point
│   ├── .env.example              ← Copy to .env and fill in
│   ├── db/database.js            ← SQLite schema + all prepared statements
│   ├── middleware/auth.js        ← JWT verify + admin guard
│   └── routes/
│       ├── auth.js               ← register, verify-email, login, refresh, logout
│       ├── users.js              ← /me, set-username, settings
│       ├── chats.js              ← CRUD + SSE streaming AI response
│       └── admin.js              ← users list, ban, suspend, reinstate
└── android/app/src/main/java/com/israelai/
    ├── MainActivity.kt           ← App entry + nav graph
    ├── admin/AdminConfig.kt      ← Owner email hardcoded here
    ├── data/
    │   ├── models/Models.kt
    │   ├── network/ApiClient.kt  ← HTTP + SSE + token storage + auto-refresh
    │   └── repository/AppRepository.kt
    ├── viewmodel/MainViewModel.kt
    └── ui/screens/
        ├── AuthScreens.kt        ← Login, Register, VerifyEmail, Username
        ├── ChatScreen.kt         ← Main chat + collapsible sidebar
        ├── AdminScreen.kt        ← Admin dashboard (owner only)
        └── SettingsScreen.kt
```

---

## Step 1 — Run the Server

```bash
cd server
cp .env.example .env
# Edit .env — fill in JWT secrets, SMTP, SERVER_URL
npm install
npm start
# Server runs on port 3000
```

**Edit `.env` minimum required fields:**
```
JWT_SECRET=some_long_random_string_here
JWT_REFRESH_SECRET=another_long_random_string_here
SERVER_URL=http://YOUR_SERVER_IP:3000
SMTP_HOST=smtp.gmail.com
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password   ← Gmail: use an App Password, not your real password
```

The SQLite database (`israelai.db`) is created automatically on first run.

---

## Step 2 — Connect Android to Your Server

In `MainViewModel.kt`, line 20, set your server address:
```kotlin
baseUrl = "http://YOUR_SERVER_IP:3000"
```

Use your server's local IP (e.g. `192.168.1.15`) if testing on the same network,
or your public IP/domain if the server is accessible from outside.

Also update `AndroidManifest.xml` — if using HTTP (not HTTPS), add:
```xml
android:usesCleartextTraffic="true"
```
to the `<application>` tag during development. Switch to HTTPS in production.

---

## Step 3 — Connect Your AI Models

In `server/routes/chats.js`, find the **`INTEGRATION POINT`** comment block and
replace the stub with your model's API call. The server streams tokens back to
the Android app via SSE (`text/event-stream`).

Format for each token:
```
data: {"token":"hello"}

data: {"token":" world"}

data: [DONE]
```

---

## Step 4 — Build the APK

**Prerequisites:** Android Studio Hedgehog+, JDK 17, Android SDK 35

Add to `android/gradle/libs.versions.toml` and `android/app/build.gradle.kts`
(same deps as before — Compose, Navigation, Serialization, DataStore).

```bash
cd android
./gradlew assembleRelease
# APK → app/build/outputs/apk/release/
```

---

## Admin Access

**Only `israelbangeni38@gmail.com` gets admin.** Enforced in 3 places:

| Layer | File | What it does |
|-------|------|--------------|
| Client UI | `AdminConfig.kt` | Shows/hides admin panel button |
| Server middleware | `middleware/auth.js → requireAdmin` | Blocks non-owner from all `/api/admin/*` routes |
| Database logic | `routes/admin.js` | Double-checks before every mutation |

When that email registers, the server automatically sets `role = 'owner'` in the DB.
The admin dashboard shows **all users** with: ID, username, email, status, joined date.
New users are auto-detected — the dashboard pulls live from the DB on load + refresh button.

### Admin Actions
| Button | Effect |
|--------|--------|
| ✅ Reinstate | `status = 'active'`, `suspended_until = NULL` |
| ⏸️ Suspend (3/7/30 days) | `status = 'suspended'`, `suspended_until = now + N days` |
| 🚫 Ban | `status = 'banned'` — permanent |

**Suspension auto-expires:** when a suspended user hits any endpoint after their
`suspended_until` time, the server auto-reinstates them and lets them through.

---

## Auth Flow

```
Register → email verification link sent
↓
User clicks link in email → /api/auth/verify-email → account activated
↓
Login → server checks: banned? suspended? verified? → issues access + refresh tokens
↓
Tokens stored in Android DataStore (persists across app restarts)
↓
On app launch: auto-refresh token → restore session → straight to chat
```

Access tokens expire in 15 minutes. Refresh tokens last 30 days.
The Android client auto-refreshes silently — user never sees a re-login unless
their refresh token expires or their account is banned/suspended.

---

## API Reference

```
POST   /api/auth/register            { email, password }
GET    /api/auth/verify-email?token=...
POST   /api/auth/login               { email, password }
POST   /api/auth/refresh             { refreshToken }
POST   /api/auth/logout              { refreshToken }

GET    /api/users/me                 (auth)
POST   /api/users/set-username       (auth) { username }
PATCH  /api/users/settings           (auth) { theme?, customPrompt? }

GET    /api/chats                    (auth)
POST   /api/chats                    (auth) { tier }
GET    /api/chats/:id/messages       (auth)
POST   /api/chats/:id/messages       (auth) { content, tier } → SSE stream
DELETE /api/chats/:id                (auth)
DELETE /api/chats                    (auth) — deletes ALL

GET    /api/admin/users              (admin only)
POST   /api/admin/ban/:userId        (admin only)
POST   /api/admin/suspend/:userId    (admin only) { days: 3|7|30 }
POST   /api/admin/reinstate/:userId  (admin only)
```
