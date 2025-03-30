"use strict";
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const dayjs = require("dayjs");
const log = require("electron-log/main");
const fs = require("node:fs");
const path$1 = require("node:path");
const commonFacade = require("@app/common");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const commonFacade__namespace = /* @__PURE__ */ _interopNamespaceDefault(commonFacade);
log.initialize();
log.errorHandler.startCatching();
log.transports.file.resolvePathFn = () => {
  const date = dayjs().format("YYYY-MM-DD");
  const logsDir = electron.app.getPath("userData");
  const logFileName = `main-${date}.log`;
  return path.join(logsDir, "logs", logFileName);
};
Object.assign(console, log.functions);
global.console = console;
let crashDumpsDir = "";
try {
  crashDumpsDir = electron.app.getPath("crashDumps");
  console.log("————————crashDumpsDir:", crashDumpsDir);
} catch (e) {
  console.error("获取崩溃文件路径失败", e);
}
electron.crashReporter.start({
  productName: "ainow",
  companyName: "aaa",
  uploadToServer: false,
  ignoreSystemCrashHandler: false
});
const { env } = process;
const isEnvSet = "ELECTRON_IS_DEV" in env;
const getFromEnv = Number.parseInt(env.ELECTRON_IS_DEV, 10) === 1;
const isDev$1 = isEnvSet ? getFromEnv : !electron.app.isPackaged;
const { DB_FILE_NAME } = commonFacade__namespace;
const dbContext = {
  getDBPath: () => isDev$1 ? path$1.posix.resolve(`../../packages/common/src/storage/${DB_FILE_NAME}`) : path$1.join(electron.app.getPath("userData"), DB_FILE_NAME),
  getPrismaEnginesDir: () => electron.app.getAppPath().replace("app.asar", ""),
  getPrismaEnginesBase: () => isDev$1 ? "../../packages/common/node_modules/@prisma/engines/" : path$1.resolve(electron.app.getAppPath().replace("app.asar", ""), "prisma/"),
  getSchemaPrismaPath: () => isDev$1 ? path$1.join(
    electron.app.getAppPath().replace("app.asar", "app.asar.unpacked"),
    "../../packages/common/src/prisma/",
    "schema.prisma"
  ) : path$1.resolve(electron.app.getAppPath().replace("app.asar", ""), "prisma/schema.prisma"),
  getPrismaPath: () => isDev$1 ? void 0 : path$1.resolve(
    electron.app.getAppPath().replace("app.asar", "app.asar.unpacked"),
    "node_modules/prisma/build/index.js"
  )
};
console.log(
  [
    "%c 💻 desktop db context ⌨",
    isDev$1,
    dbContext.getPrismaPath?.(),
    dbContext.getSchemaPrismaPath?.(),
    dbContext.getDBPath(),
    dbContext.getPrismaEnginesBase?.()
  ].join("\n"),
  "color: red;"
);
const { getPrisma, getDBConstants, DBModels, runPrismaCommand } = commonFacade__namespace;
const { getAccountModel, getThreadModel, getThreadMessageModel } = DBModels;
const { dbPath, latestMigration } = getDBConstants(dbContext);
const isDev = process.env.NODE_ENV === "development";
const schemaPath = isDev ? dbContext.getSchemaPrismaPath() : path$1.join(process.resourcesPath, "prisma", "schema.prisma");
const prismaPath = dbContext.getPrismaPath?.();
process.env.DATABASE_URL = `file:${dbPath}`;
const prisma = getPrisma(dbContext);
const modelsFactory = {
  Account: getAccountModel,
  Thread: getThreadModel,
  ThreadMessage: getThreadMessageModel
};
const runPrisma = (...args) => runPrismaCommand({
  ctx: dbContext,
  command: [...args, "--schema", schemaPath],
  prismaPath
});
async function handlePersistenceAction(_, model, action, ...args) {
  try {
    const modelInstanceGetter = modelsFactory[model];
    if (!modelInstanceGetter) throw new Error(`factory function for ${model} not found`);
    const m = modelInstanceGetter(prisma);
    if (!m) throw new Error(`model ${model} not found`);
    return m[action](...args);
  } catch (error) {
    console.error(error);
  }
  return null;
}
async function initDB() {
  let needsMigration = false;
  const dbExists = fs.existsSync(dbPath);
  if (!dbExists) {
    needsMigration = true;
    fs.closeSync(fs.openSync(dbPath, "w"));
  }
  try {
    const latest = await prisma.$queryRaw`select * from _prisma_migrations order by finished_at`;
    const mname = latest[latest.length - 1]?.migration_name;
    needsMigration = !mname.endsWith(latestMigration);
    console.log(`db latest migration: ${mname}, want migration suffix: ${latestMigration}`);
  } catch (e) {
    console.error("[db.ts SELECT *]", e, prisma?._engine?.datasourceOverrides);
    needsMigration = true;
  }
  if (!needsMigration) {
    console.log(`%c Does not need migration -- ${schemaPath}`, "color: green");
    return;
  }
  try {
    console.log(
      `%c Needs a migration. Running prisma migrate with schema path ${schemaPath}`,
      "color: red"
    );
    await runPrisma("migrate", "deploy");
    console.log("√ Migration done.");
  } catch (e) {
    console.error("× Migration failed.", e);
    try {
      await runPrisma("migrate", "reset", "--force");
      await runPrisma("migrate", "deploy");
      console.log("Migration reset.");
    } catch (ex) {
      await runPrisma("migrate", "deploy");
      console.error("🐝 Migration again and anain", ex);
    }
  }
}
const MAIN_WINDOW_WIDTH = 1100;
const MAIN_WINDOW_HEIGHT = 800;
const MINI_WINDOW_WIDTH = 540;
const MINI_WINDOW_HEIGHT = 540;
var WindowActions = /* @__PURE__ */ ((WindowActions2) => {
  WindowActions2[WindowActions2["MIN"] = 0] = "MIN";
  WindowActions2[WindowActions2["MAX"] = 1] = "MAX";
  WindowActions2[WindowActions2["CLOSE"] = 2] = "CLOSE";
  return WindowActions2;
})(WindowActions || {});
const displayName = "myApp";
class WindowManager {
  static instance;
  // @ts-ignore for single instance
  windows;
  constructor() {
    if (WindowManager.instance) {
      return WindowManager.instance;
    }
    this.windows = /* @__PURE__ */ new Map();
    WindowManager.instance = this;
    return this;
  }
  static getInstance() {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager();
    }
    return WindowManager.instance;
  }
  register(win) {
    const windowId = Date.now();
    this.windows.set(windowId, win);
    win.webContents.on("did-finish-load", () => {
      win.webContents.executeJavaScript(`window.windowId = ${windowId}`);
      win.webContents.send("set-title", displayName);
      function sendDBStatus() {
        win.webContents.send("db-status", global.isDBReady);
        if (global.isDBReady) return;
        setTimeout(sendDBStatus, 500);
      }
      sendDBStatus();
    });
    return windowId;
  }
  handleAction(id, action) {
    const win = this.windows.get(id);
    if (!win) return;
    switch (action) {
      case WindowActions.MIN:
        win.minimize();
        break;
      case WindowActions.MAX:
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
      case WindowActions.CLOSE:
        if (this.windows.size > 1) {
          win.destroy();
          this.windows.delete(id);
        } else {
          win.close();
        }
        break;
    }
  }
}
const winMgr$1 = new WindowManager();
async function createMainWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MINI_WINDOW_WIDTH,
    minHeight: MINI_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    useContentSize: true,
    frame: false,
    title: "mainwindow",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  global.mainWindow = mainWindow;
  winMgr$1.register(mainWindow);
  mainWindow.on("ready-to-show", () => {
    process.argv.slice(1);
    mainWindow.show();
  });
  mainWindow.on("close", (e) => {
    if (!global.isQuitFromTray) {
      e.preventDefault();
      mainWindow.setSkipTaskbar(true);
      mainWindow.hide();
    }
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
global.isElectronDev = isDev$1;
global.electronApp = electron.app;
global.isDBReady = false;
const winMgr = new WindowManager();
const isSingleLockApp = electron.app.requestSingleInstanceLock();
if (!isSingleLockApp) {
  electron.app.quit();
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  initDB().then(() => {
    global.isDBReady = true;
  });
  electron.ipcMain.handle("llm:persistence-action", handlePersistenceAction);
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  electron.ipcMain.on(
    "window-action",
    (_, id, action) => winMgr.handleAction(id, action)
  );
  createMainWindow();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
