const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("../server");
const desktopConfig = require("./config.json");

let windowManager;
let windowManagerError;
try {
  ({ windowManager } = require("node-window-manager"));
} catch (error) {
  windowManagerError = error;
}

const HOST = "127.0.0.1";
let server;
let mainWindow;
let widgetWindow;
let tray;
let serverOrigin;
let previousWindowId = null;
let isQuitting = false;
let currentSession = null;
const sessionPath = path.join(app.getPath("userData"), "session.bin");
const microphoneGrants = new WeakSet();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function isTrustedFrame(event) {
  if (!serverOrigin || !event.senderFrame) return false;
  return new URL(event.senderFrame.url).origin === serverOrigin;
}

function isTrustedUrl(url) {
  if (!serverOrigin) return false;
  return new URL(url).origin === serverOrigin;
}

function rememberPreviousWindow() {
  if (!windowManager) return;
  try {
    const activeWindow = windowManager.getActiveWindow();
    const ownWindowId = mainWindow?.getNativeWindowHandle().readUInt32LE(0);
    const widgetWindowId = widgetWindow?.getNativeWindowHandle().readUInt32LE(0);
    if (activeWindow?.isWindow() && activeWindow.isVisible()
      && activeWindow.id !== ownWindowId && activeWindow.id !== widgetWindowId) {
      previousWindowId = activeWindow.id;
    }
  } catch (error) {
    console.error("Could not identify the previously active window:", error);
    previousWindowId = null;
  }
}

function getPreviousWindow() {
  if (!windowManager) {
    throw new Error(`Windows app control is unavailable because its native module could not load: ${windowManagerError?.message || "unknown error"}`);
  }
  if (previousWindowId === null) return null;
  const target = windowManager.getWindows().find((window) => window.id === previousWindowId);
  return target?.isWindow() && target.isVisible() ? target : null;
}

function getBackendEndpoint(endpoint) {
  if (typeof desktopConfig.backendUrl !== "string" || !desktopConfig.backendUrl.trim()) {
    throw new Error("Zoe's hosted backend is not configured for this installation.");
  }
  const baseUrl = new URL(desktopConfig.backendUrl);
  const isLoopback = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (baseUrl.protocol !== "https:" && !(isLoopback && baseUrl.protocol === "http:")) {
    throw new Error("Zoe's hosted backend must use HTTPS.");
  }
  return new URL(endpoint, `${baseUrl.href.replace(/\/+$/, "")}/`).href;
}

async function requestBackend(endpoint, { body, token } = {}) {
  const response = await fetch(getBackendEndpoint(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(result.error || "Zoe's hosted service could not complete the request."), {
      status: response.status,
    });
  }
  return result;
}

function readStoredSession() {
  if (!fs.existsSync(sessionPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable; Zoe cannot safely open the saved session.");
  }
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionPath)));
}

function saveStoredSession(session) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable; Zoe cannot safely save this session.");
  }
  fs.writeFileSync(sessionPath, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
}

function clearStoredSession() {
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  currentSession = null;
}

async function getValidSession() {
  if (!currentSession) currentSession = readStoredSession();
  if (!currentSession) return null;
  try {
    const result = await requestBackend("/v1/auth/session", { token: currentSession.accessToken });
    return { session: currentSession, user: result.user };
  } catch (error) {
    if (error.status !== 401 || !currentSession.refreshToken) throw error;
    const refreshed = await requestBackend("/v1/auth/refresh", {
      body: { refreshToken: currentSession.refreshToken },
      token: currentSession.accessToken,
    });
    currentSession = refreshed.session;
    saveStoredSession(currentSession);
    return { session: currentSession, user: refreshed.user };
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  rememberPreviousWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 700,
    show: false,
    backgroundColor: "#11100f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", showWindow);
  mainWindow.on("blur", rememberPreviousWindow);
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const isTrustedAudioRequest = webContents === mainWindow.webContents
      && permission === "media"
      && details.requestingUrl
      && isTrustedUrl(details.requestingUrl)
      && details.mediaTypes?.includes("audio")
      && !details.mediaTypes.includes("video");
    if (!isTrustedAudioRequest) {
      callback(false);
      return;
    }
    if (microphoneGrants.has(webContents)) {
      callback(true);
      return;
    }

    dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Allow microphone", "Not now"],
      defaultId: 1,
      cancelId: 1,
      title: "Allow Zoe to use your microphone?",
      message: "Zoe needs microphone access to hear a voice instruction.",
      detail: "The browser speech service may process your audio. Zoe only listens after you tap the microphone.",
    }).then(({ response }) => {
      const granted = response === 0;
      if (granted) microphoneGrants.add(webContents);
      callback(granted);
    }).catch((error) => {
      console.error("Could not request microphone permission:", error);
      callback(false);
    });
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => (
    webContents === mainWindow?.webContents
      && permission === "media"
      && requestingOrigin === serverOrigin
      && microphoneGrants.has(webContents)
  ));
  mainWindow.loadURL(serverOrigin);
}

function createWidgetWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  widgetWindow = new BrowserWindow({
    width: 88,
    height: 88,
    x: x + width - 112,
    y: y + height - 112,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  widgetWindow.setAlwaysOnTop(true, "floating");
  widgetWindow.setVisibleOnAllWorkspaces(true);
  widgetWindow.once("ready-to-show", () => widgetWindow.show());
  widgetWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  widgetWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  widgetWindow.loadURL(new URL("/widget.html", serverOrigin).href);
}

function createTray() {
  const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="9" fill="#e77a3b"/><text x="16" y="21" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="12" font-weight="800" fill="#28150d">zoe</text></svg>';
  tray = new Tray(nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`,
  ));
  tray.setToolTip("Zoe");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Zoe", click: showWindow },
    {
      label: "Start Zoe when I sign in",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({
        openAtLogin: item.checked,
        openAsHidden: item.checked,
      }),
    },
    { type: "separator" },
    {
      label: "Quit Zoe",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showWindow);
}

ipcMain.handle("zoe:get-session", async (event) => {
  if (!isTrustedFrame(event)) throw new Error("Untrusted window.");
  const result = await getValidSession();
  return result?.user || null;
});

ipcMain.handle("zoe:authenticate", async (event, details) => {
  if (!isTrustedFrame(event)) throw new Error("Untrusted window.");
  if (!details || !["signin", "signup"].includes(details.mode)) {
    throw new Error("Choose sign in or account creation.");
  }
  const result = await requestBackend(`/v1/auth/${details.mode}`, {
    body: {
      email: details.email,
      password: details.password,
      name: details.name,
    },
  });
  if (result.needsEmailConfirmation) return result;
  if (!result.session?.accessToken || !result.session?.refreshToken || !result.user) {
    throw new Error("The hosted account service returned an invalid session.");
  }
  currentSession = result.session;
  saveStoredSession(currentSession);
  return { user: result.user };
});

ipcMain.handle("zoe:sign-out", async (event) => {
  if (!isTrustedFrame(event)) throw new Error("Untrusted window.");
  const session = await getValidSession();
  let signOutError;
  if (session) {
    try {
      await requestBackend("/v1/auth/signout", { token: session.session.accessToken });
    } catch (error) {
      signOutError = error;
    }
  }
  clearStoredSession();
  if (signOutError) throw signOutError;
  return { signedOut: true };
});

ipcMain.handle("zoe:chat", async (event, message) => {
  if (!isTrustedFrame(event)) throw new Error("Untrusted window.");
  if (typeof message !== "string" || !message.trim() || message.length > 1000) {
    throw new Error("Message must be a non-empty string of at most 1000 characters.");
  }
  const session = await getValidSession();
  if (!session) throw new Error("Sign in to chat with Zoe.");
  return requestBackend("/v1/chat", {
    body: { message: message.trim() },
    token: session.session.accessToken,
  });
});

ipcMain.handle("zoe:minimize-previous-window", async (event) => {
  if (!isTrustedFrame(event)) throw new Error("Untrusted window.");
  const target = getPreviousWindow();
  if (!target) {
    throw new Error("There is no available app window to minimize. Switch to an app, then return to Zoe and try again.");
  }
  if (target.id === mainWindow?.getNativeWindowHandle().readUInt32LE(0)) {
    throw new Error("Zoe cannot minimize its own window with this action.");
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Confirm app action",
    message: `Minimize ${target.getTitle() || "the previously active app"}?`,
    detail: "Zoe will minimize only this window. No other computer actions will be run.",
    buttons: ["Cancel", "Minimize app"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response !== 1) return { minimized: false };

  const stillOpen = getPreviousWindow();
  if (!stillOpen || stillOpen.id !== target.id) {
    throw new Error("That app window is no longer available. Ask Zoe again.");
  }
  stillOpen.minimize();
  previousWindowId = null;
  return { minimized: true, title: target.getTitle() || "the app" };
});

ipcMain.handle("zoe:open-assistant", async (event) => {
  if (!widgetWindow || event.sender !== widgetWindow.webContents || !isTrustedFrame(event)) {
    throw new Error("Untrusted window.");
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Zoe's main window is unavailable.");
  }
  await mainWindow.loadURL(new URL("/chat.html", serverOrigin).href);
  showWindow();
  return { opened: true };
});

app.on("second-instance", showWindow);
app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (server?.listening) server.close();
});

app.whenReady().then(() => {
  server = createServer();
  server.on("error", (error) => {
    console.error("Could not start Zoe's local interface:", error);
    dialog.showErrorBox("Zoe could not start", error.message);
    app.quit();
  });
  server.listen(0, HOST, () => {
    serverOrigin = `http://${HOST}:${server.address().port}`;
    createWindow();
    createWidgetWindow();
    createTray();
    globalShortcut.register("Control+Alt+Z", showWindow);
  });
});
