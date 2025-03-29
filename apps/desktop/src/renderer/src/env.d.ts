/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare const __ELECTRON__: boolean
declare const __WEB__: boolean
// @ts-nocheck
interface Window {
  api: any // TODO: specify the correct type
  electron: {
    process: NodeJS.Process
    ipcRenderer: {
      invoke(channel: string, ...args: string[]): Promise<string>
      send: (channel: string, ...args: string[]) => void
    }
  }
}
