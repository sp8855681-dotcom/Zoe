const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zoeDesktop", Object.freeze({
  isDesktop: true,
  getSession: () => ipcRenderer.invoke("zoe:get-session"),
  authenticate: (details) => ipcRenderer.invoke("zoe:authenticate", details),
  signOut: () => ipcRenderer.invoke("zoe:sign-out"),
  chat: (message) => ipcRenderer.invoke("zoe:chat", message),
  minimizePreviousWindow: () => ipcRenderer.invoke("zoe:minimize-previous-window"),
  openAssistant: () => ipcRenderer.invoke("zoe:open-assistant"),
}));
