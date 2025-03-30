import { join } from 'path'
import dayjs from 'dayjs'
import { app, crashReporter } from 'electron'
import log from 'electron-log/main.js'

log.initialize() // ~\AppData\Roaming\@app\desktop\logs\xxx.log
log.errorHandler.startCatching()
log.transports.file.resolvePathFn = () => {
  const date = dayjs().format('YYYY-MM-DD')
  const logsDir = app.getPath('userData')
  const logFileName = `main-${date}.log`
  return join(logsDir, 'logs', logFileName)
}
Object.assign(console, log.functions)
global.console = console

let crashDumpsDir = ''
try {
  crashDumpsDir = app.getPath('crashDumps')
  console.log('————————crashDumpsDir:', crashDumpsDir)
} catch (e) {
  console.error('获取崩溃文件路径失败', e)
}
crashReporter.start({
  productName: 'myApp',
  companyName: 'aaa',
  uploadToServer: false,
  ignoreSystemCrashHandler: false
})
