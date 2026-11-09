# Zoe

Zoe is being developed as a permission-first Windows desktop assistant. The current build adds an Electron desktop shell to the existing interface; it is not yet a production release.

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

The desktop sign-in and OpenAI service use a Supabase-backed API. Copy `backend/.env.example` to `backend/.env` for local service development, then configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `OPENAI_API_KEY` on the backend host. Never put the OpenAI key in the desktop app or commit it. The Supabase project must allow account sign-up and have email confirmation configured.

Run the API locally with `npm run backend`. Before packaging a release, set `backendUrl` in `electron/config.json` to the deployed HTTPS API URL. The release script refuses an empty or non-HTTPS URL.

This backend starter uses in-memory rate limits; deploy a shared rate-limit store before running multiple API instances. Before public launch, also configure HTTPS, privacy disclosures for OpenAI processing, account recovery, monitoring, abuse controls, and Windows code signing.

## Current release gaps

- Chat now has an optional, user-started microphone control in runtimes that support the Web Speech API. Zoe speaks replies using the system speech-synthesis service. Voice input is recognized by the browser speech service; the transcript is not shown, but the recognized instruction is sent to Zoe's chat service. Audio handling, availability, and terms depend on the browser provider, so this is not a guaranteed or contractually free production speech service. The Windows app asks before granting microphone access. Zoe still asks for approval before proposed navigation.
- Wake-word listening is not implemented. Zoe does not listen in the background.
- Zoe does not run on the Windows lock screen.
- The browser preview still uses demo sign-in and local keyword replies; only the desktop app calls the hosted API.
- Account recovery and email-confirmation deep links back into the app are not implemented.

## Website preview

To preview the interface in a browser without installing Electron:

```powershell
node server.js
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The browser preview cannot control other applications or display the always-on-top desktop orb.
