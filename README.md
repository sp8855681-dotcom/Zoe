# Zoe

Zoe is a web-based AI assistant that can be installed from a browser as a Progressive Web App (PWA). A separate Windows desktop app is also available.

## Run the desktop app

Install Node.js 22 or later, then run:

```powershell
npm install
npm start
```

Zoe opens in a desktop window and stays available from the system tray. A small purple Zoe orb stays above other windows; click it to open Zoe's chat. **Ctrl+Alt+Z** brings Zoe's main window to the front. Closing the window hides it; choose **Quit Zoe** from the tray menu to exit.

## Build the Windows installer

```powershell
npm run rebuild-native
npm run dist
```

This creates a Windows NSIS installer under `dist`. The native window-control module needs the Visual Studio **Desktop development with C++** workload. The included GitHub Actions workflow can build Windows installers on a Windows runner after the project is pushed to GitHub.

## OS action permission

The current desktop shell only supports asking Windows to minimize the app Zoe was focused on before. Windows displays a native confirmation dialog; Zoe does not minimize anything unless the user approves. The renderer cannot run shell commands or choose arbitrary processes. This action is only available in the installed desktop app.

Zoe does not run on the Windows lock screen. Windows protects that surface from ordinary desktop apps. Microphone and wake-word access are not enabled in this build.

## Account and AI service setup

The web app and desktop sign-in use a Supabase-backed API. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` as private environment variables on the backend host. Never put the OpenAI key or service-role key in frontend code or commit either key. The Supabase project must allow account sign-up. Set its site URL and redirect URL allowlist to the deployed Zoe HTTPS origin so email confirmation links return to the app.

Before enabling public chat, run [`backend/supabase/chat-quota.sql`](./backend/supabase/chat-quota.sql) in the Supabase SQL Editor. It creates private daily usage tables and an atomic quota function. The backend enforces a maximum of 60 chats per account per UTC day and 60 chats total per UTC day, and limits each AI reply to 60 generated tokens. If the quota function or service-role key is unavailable, the backend fails closed and does not call OpenAI.

The backend serves the PWA files and the `/v1` API from the same origin. On Render, run `node backend/server.js` as the start command, configure the four private environment variables above, and open the service's root HTTPS URL. The existing Render service can serve both the website and API after this version is deployed; no separate frontend or CORS setup is needed.

For local web development, copy `backend/.env.example` to `backend/.env`, fill in the service values, and run:

```powershell
npm run preview
```

Open [http://127.0.0.1:4180](http://127.0.0.1:4180). The preview runs the same web/API server as the hosted service.

The Windows app uses the deployed API URL in `electron/config.json`; the release script requires an HTTPS URL.

## Install Zoe from a browser

Visit the deployed HTTPS URL, sign in or create an account, then use your browser's **Install app** option. Supported browsers may also show an **Install Zoe** button on the dashboard. On iPhone or iPad, use Safari's **Share → Add to Home Screen**. The app shell can open offline, but signing in and chatting require an internet connection.

The PWA service worker caches only the interface and static assets. It does not cache account sessions, authentication responses, or AI conversations. The web assistant can answer questions but cannot access local files or control the user's device. Optional voice input uses the browser speech provider, whose availability and audio handling depend on that provider.

## Public-use and billing warning

Every chat is sent to OpenAI using the service owner's API key, so user activity can incur charges. Supabase-backed daily quotas limit requests across restarts and service instances, but there is no hard dollar-denominated spending cap. Monitor OpenAI usage and set the provider's available budget alerts/limits before inviting public traffic.

## Current release gaps

- Chat now has an optional, user-started microphone control in runtimes that support the Web Speech API. Zoe speaks replies using the system speech-synthesis service. Voice input is recognized by the browser speech service; the transcript is not shown, but the recognized instruction is sent to Zoe's chat service. Audio handling, availability, and terms depend on the browser provider, so this is not a guaranteed or contractually free production speech service. The Windows app asks before granting microphone access. Zoe still asks for approval before proposed navigation.
- Wake-word listening is not implemented. Zoe does not listen in the background.
- Zoe does not run on the Windows lock screen.
- Account recovery and customized email-confirmation flows are not implemented.
- GitHub Pages is a static preview and does not provide the hosted authentication or AI service. Use the Render service URL for the installable app.

The local Electron renderer server remains available internally to the Windows desktop app; use `npm run preview` for the web app.
