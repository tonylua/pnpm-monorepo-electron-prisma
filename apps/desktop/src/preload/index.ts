import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  dbStatus: (status: boolean) => ipcRenderer.send('db-status', status),
  persistenceAction: (model: string, action: string, ...args) =>
    ipcRenderer.invoke('llm:persistence-action', model, action, ...args),
}
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
