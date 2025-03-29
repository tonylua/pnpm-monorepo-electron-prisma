import { shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import {
  MAIN_WINDOW_HEIGHT,
  MAIN_WINDOW_WIDTH,
  MINI_WINDOW_HEIGHT,
  MINI_WINDOW_WIDTH
} from './utils/constants'
import WindowManager from './utils/WindowManager'

const winMgr = new WindowManager()

export async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MINI_WINDOW_WIDTH,
    minHeight: MINI_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    useContentSize: true,
    frame: false,
    title: 'mainwindow',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  global.mainWindow = mainWindow
  winMgr.register(mainWindow)

  mainWindow.on('ready-to-show', () => {
    const args = process.argv.slice(1)
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!global.isQuitFromTray) {
      e.preventDefault()
      mainWindow.setSkipTaskbar(true)
      mainWindow.hide()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
