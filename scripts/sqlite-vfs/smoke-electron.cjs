const { app } = require('electron')
const { verify } = require('./verify-vfs.cjs')

app.disableHardwareAcceleration()
app.whenReady().then(() =>
  verify()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      app.exit(result.ok ? 0 : 1)
    })
    .catch((error) => {
      process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`)
      app.exit(1)
    })
)
