// Runs `prisma db update` or `prisma db verify` on an encrypted database by
// loading the DLL + resolving the file key + spawning the ControlClient. This
// repo's safeStorage key lives at AppData/@app/desktop/*.key, so the script
// must run as a real Electron app (not ELECTRON_RUN_AS_NODE) so app.getPath()
// matches. Invoked by packages/common/scripts/db-with-vfs.mjs.
const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { createRequire } = require('node:module')

const repoRoot = path.resolve(__dirname, '../..')
const dllPath = path.join(repoRoot, 'apps/desktop/resources/encrypted_vfs.dll')
const target = {
  file: path.join(repoRoot, 'packages/common/src/storage/myDb.db'),
  account: 'db-file-vfs-main-v1',
  migrationsDir: path.join(repoRoot, 'packages/common/src/prisma/migrations')
}

function activate(filePath, key) {
  const boot = new DatabaseSync(':memory:', { allowExtension: true })
  boot.loadExtension(dllPath)
  boot.prepare('SELECT encrypted_vfs_activate()').get()
  const result = boot
    .prepare('SELECT encrypted_vfs_register_db(?, ?, ?) AS result')
    .get(filePath, key, 'open-existing')
  if (result.result !== 'ok') throw new Error('VFS_UNAVAILABLE')
  return boot
}

async function selfTest() {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vfs-maintain-'))
  const file = path.join(dir, 't.db')
  const key = require('node:crypto').randomBytes(32)
  const boot = new DatabaseSync(':memory:', { allowExtension: true })
  boot.loadExtension(dllPath)
  boot.prepare('SELECT encrypted_vfs_activate()').get()
  boot.prepare('SELECT encrypted_vfs_register_db(?, ?, ?)').get(file, key, 'create-new')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE t(note TEXT)')
  db.exec("INSERT INTO t(note) VALUES ('maintain')")
  const row = db.prepare('SELECT note FROM t').get()
  db.close()
  boot.prepare('SELECT encrypted_vfs_shutdown(?)').get('')
  boot.close()
  fs.rmSync(dir, { recursive: true, force: true })
  if (row.note !== 'maintain') throw new Error('self-test readback failed')
  return 0
}

async function maintain(command) {
  if (!fs.existsSync(dllPath)) throw new Error('VFS_UNAVAILABLE')
  const keyFile = path.join(app.getPath('userData'), `${target.account}.key`)
  if (!safeStorage.isEncryptionAvailable()) throw new Error(`KEY_UNAVAILABLE:${target.account}`)
  const hex = safeStorage.decryptString(fs.readFileSync(keyFile))
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error(`KEY_INVALID:${target.account}`)
  const boot = activate(target.file, key)
  try {
    if (command === 'verify') {
      const db = new DatabaseSync(target.file)
      const integrity = db.prepare('PRAGMA integrity_check').get()
      const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
      db.close()
      if (integrity.integrity_check !== 'ok' || foreignKeys.length !== 0) {
        throw new Error('DATABASE_AUTH_FAILED')
      }
      process.stdout.write('encrypted database verified\n')
      return 0
    }
    if (command !== 'update') throw new Error(`unknown command ${command}`)
    const requireCommon = createRequire(path.join(repoRoot, 'packages/common/package.json'))
    const commonFacade = requireCommon('./dist/index.js')
    const runPrismaCommand = commonFacade.runPrismaCommand
    await runPrismaCommand({
      ctx: {
        getDBPath: () => target.file,
        getMigrationsDir: () => target.migrationsDir
      }
    })
    return 0
  } finally {
    try {
      boot.prepare('SELECT encrypted_vfs_shutdown(?)').get('')
    } catch {
      // Connections opened by ControlClient may still be live. The process exits next.
    }
    boot.close()
    key.fill(0)
  }
}

async function main() {
  const command = process.env.EVFS_COMMAND || process.argv.slice(2)[0]
  if (command === 'self-test') return selfTest()
  return maintain(command)
}

if ((process.env.EVFS_COMMAND || process.argv[2]) === 'self-test') {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`)
      process.exit(1)
    })
} else {
  app.disableHardwareAcceleration()
  app.whenReady().then(() =>
    main()
      .then((code) => app.exit(code))
      .catch((error) => {
        process.stderr.write(`${error.stack || error}\n`)
        app.exit(1)
      })
  )
}
