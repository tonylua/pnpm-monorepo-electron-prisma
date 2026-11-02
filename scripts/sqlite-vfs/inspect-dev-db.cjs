// Read-only inspection of the dev database using the real safeStorage key.
// Confirms the migrated file still holds the original rows and that no row
// text is recoverable from the raw bytes. Must run as a real Electron app
// (not ELECTRON_RUN_AS_NODE) because safeStorage needs app.whenReady().
const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')
const { DatabaseSync } = require('node:sqlite')

const repoRoot = path.resolve(__dirname, '../..')
const dllPath = path.join(repoRoot, 'apps/desktop/resources/encrypted_vfs.dll')
const dbPath = path.join(repoRoot, 'packages/common/src/storage/myDb.db')

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const out = {}
  try {
    // Run as a bare Electron app, app.getName() is "Electron", so userData
    // does not match the real app's "@app/desktop". Allow an explicit path.
    // safeStorage on Windows is DPAPI per-user, so the same user can decrypt
    // a key written under a different app name.
    // Read from an env var, not argv: Electron switches such as
    // --user-data-dir shift positional arguments.
    const keyFile =
      process.env.EVFS_KEY_FILE ||
      path.join(app.getPath('userData'), 'db-file-vfs-main-v1.key')
    out.userData = app.getPath('userData')
    out.keyFile = keyFile
    out.keyFileExists = fs.existsSync(keyFile)
    const hex = safeStorage.decryptString(fs.readFileSync(keyFile))
    const key = Buffer.from(hex, 'hex')
    out.keyBytes = key.length

    const boot = new DatabaseSync(':memory:', { allowExtension: true })
    boot.loadExtension(dllPath)
    boot.enableLoadExtension(false)
    boot.prepare('SELECT encrypted_vfs_activate()').get()
    const row = boot
      .prepare('SELECT encrypted_vfs_register_db(?, ?, ?) AS result')
      .get(dbPath, key, 'open-existing')
    out.register = row.result

    const db = new DatabaseSync(dbPath)
    out.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
    out.journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode
    out.accounts = db.prepare('SELECT * FROM "Account"').all()
    out.threadCount = db.prepare('SELECT COUNT(*) AS n FROM "Thread"').get().n
    out.threads = db.prepare('SELECT * FROM "Thread" ORDER BY rowid').all()
    db.close()

    // Any account/thread text must be absent from the raw file bytes.
    const raw = fs.readFileSync(dbPath)
    out.header = raw.subarray(0, 5).toString('utf8')
    const needles = []
    for (const a of out.accounts) {
      for (const v of Object.values(a)) {
        if (typeof v === 'string' && v.length >= 4) needles.push(v)
      }
    }
    for (const t of out.threads) {
      for (const v of Object.values(t)) {
        if (typeof v === 'string' && v.length >= 4) needles.push(v)
      }
    }
    out.checkedNeedles = needles
    out.leaked = needles.filter((n) => raw.includes(Buffer.from(n)))

    boot.prepare('SELECT encrypted_vfs_shutdown(?)').get('force')
    boot.close()
    key.fill(0)

    out.ok =
      out.header === 'EVFS1' &&
      out.integrity === 'ok' &&
      out.journalMode === 'delete' &&
      out.leaked.length === 0
  } catch (error) {
    out.error = error && error.stack ? error.stack : String(error)
    out.ok = false
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  app.exit(out.ok ? 0 : 1)
})
