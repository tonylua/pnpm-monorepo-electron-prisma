import { BrowserWindow } from 'electron'
import { WindowActions } from './constants'
import { displayName } from '../../../../../package.json'

export default class WindowManager {
  private static instance: WindowManager
  // @ts-ignore for single instance
  windows: Map<number, BrowserWindow>

  constructor() {
    if (WindowManager.instance) {
      return WindowManager.instance
    }
    this.windows = new Map()
    WindowManager.instance = this
    return this
  }

  public static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager()
    }
    return WindowManager.instance
  }

  register(win: BrowserWindow) {
    const windowId = Date.now()
    this.windows.set(windowId, win)
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(`window.windowId = ${windowId}`)
      win.webContents.send('set-title', displayName)

      function sendDBStatus() {
        win.webContents.send('db-status', global.isDBReady)
        if (global.isDBReady) return
        setTimeout(sendDBStatus, 500)
      }
      sendDBStatus()
    })
    return windowId
  }

  handleAction(id: number, action: WindowActions) {
    const win = this.windows.get(id)
    if (!win) return
    switch (action) {
      case WindowActions.MIN:
        win.minimize()
        break
      case WindowActions.MAX:
        win.isMaximized() ? win.unmaximize() : win.maximize()
        break
      case WindowActions.CLOSE:
        if (this.windows.size > 1) {
          win.destroy()
          this.windows.delete(id)
        } else {
          win.close()
        }
        break
    }
  }
}
