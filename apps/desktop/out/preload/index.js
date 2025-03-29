"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const api = {
  setTitle: (title) => electron.ipcRenderer.send("set-title", title),
  dbStatus: (status) => electron.ipcRenderer.send("db-status", status),
  windowAction: (windowId, action) => {
    electron.ipcRenderer.send("window-action", windowId, action);
  },
  persistenceAction: (model, action, ...args) => electron.ipcRenderer.invoke("llm:persistence-action", model, action, ...args)
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = preload.electronAPI;
  window.api = api;
}
