import { shell, BrowserWindow } from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "path";
import {
  MAIN_WINDOW_HEIGHT,
  MAIN_WINDOW_WIDTH,
  MINI_WINDOW_HEIGHT,
  MINI_WINDOW_WIDTH,
} from "./utils/constants";
import { displayName } from "../../../../package.json";

export async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MINI_WINDOW_WIDTH,
    minHeight: MINI_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    useContentSize: true,
    frame: true,
    title: displayName,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  global.mainWindow = mainWindow;

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("set-title", displayName);

    function sendDBStatus() {
      mainWindow.webContents.send("db-status", global.isDBReady);
      if (global.isDBReady) return;
      setTimeout(sendDBStatus, 500);
    }
    sendDBStatus();
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", () => {});

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}
