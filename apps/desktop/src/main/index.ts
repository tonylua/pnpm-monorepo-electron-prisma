import { app, ipcMain } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import "./utils/logs";
import { initDB, handlePersistenceAction } from "./utils";
import { isDev } from "./utils/isDev";
import { createMainWindow } from "./MainWin";

global.isElectronDev = isDev;
global.electronApp = app;
global.isDBReady = false;

const isSingleLockApp = app.requestSingleInstanceLock();
if (!isSingleLockApp) {
  app.quit();
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  initDB().then(
    () => {
      global.isDBReady = true;
    },
    (error) => {
      // A failed init means the encrypted database could not be opened (missing
      // key, missing DLL, unrecognized format). isDBReady stays false and the
      // IPC gate rejects; do not fall back to an unencrypted database.
      global.isDBReady = false;
      console.error("[main] initDB failed", error);
    },
  );
  ipcMain.handle("llm:persistence-action", handlePersistenceAction);

  createMainWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
