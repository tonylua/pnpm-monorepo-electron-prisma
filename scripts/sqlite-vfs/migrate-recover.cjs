const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { DatabaseSync, backup } = require('node:sqlite')
const { headerKind, migrateDatabase, migrationPaths } = require('../../apps/desktop/src/main/utils/encryptedMigrate.cjs')

const dllPath = path.resolve(__dirname, '../../apps/desktop/resources/encrypted_vfs.dll')

function win32Uri(filePath) {
  const uri = pathToFileURL(filePath)
  uri.searchParams.set('vfs', 'win32')
  return uri
}

function harness(dir) {
  const boot = new DatabaseSync(':memory:', { allowExtension: true })
  boot.loadExtension(dllPath)
  boot.prepare('SELECT encrypted_vfs_activate()').get()
  const key = crypto.randomBytes(32)
  const file = path.join(dir, 'plain.db')
  const plain = new DatabaseSync(win32Uri(file))
  plain.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, note TEXT)')
  plain.exec("INSERT INTO t(id, note) VALUES (1, 'kept')")
  plain.exec('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES t(id))')
  plain.close()
  const register = (target) => {
    boot.prepare('SELECT encrypted_vfs_register_db(?, ?, ?)').get(target, key, 'create-new')
  }
  const io = {
    async verifyEncrypted(target) {
      register(target)
      const db = new DatabaseSync(target)
      const row = db.prepare('PRAGMA integrity_check').get()
      db.close()
      if (row.integrity_check !== 'ok') throw new Error('DATABASE_AUTH_FAILED')
    },
    async digestPlain(target) {
      const db = new DatabaseSync(win32Uri(target))
      try {
        return require('../../apps/desktop/src/main/utils/encryptedMigrate.cjs').databaseDigest(db)
      } finally {
        db.close()
      }
    },
    async digestEncrypted(target) {
      register(target)
      const db = new DatabaseSync(target)
      try {
        return require('../../apps/desktop/src/main/utils/encryptedMigrate.cjs').databaseDigest(db)
      } finally {
        db.close()
      }
    },
    async copy(source, destination) {
      fs.rmSync(destination, { force: true })
      register(destination)
      const sourceDb = new DatabaseSync(win32Uri(source))
      try {
        await backup(sourceDb, destination)
      } finally {
        sourceDb.close()
      }
    },
    async replaceFile(from, to) {
      fs.renameSync(from, to)
    }
  }
  return { boot, file, io }
}

async function run() {
  const stops = ['SOURCE_VERIFIED', 'TARGET_COPYING', 'TARGET_VERIFIED', 'SWITCHING', null]
  for (const stopAt of stops) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-migrate-'))
    const session = harness(dir)
    const first = await migrateDatabase(session.file, { ...session.io, stopAt: stopAt || undefined })
    const second = await migrateDatabase(session.file, session.io)
    if (second !== 'encrypted' && second !== 'ACTIVE') throw new Error(`resume ${stopAt} -> ${second}`)
    if (headerKind(session.file) !== 'encrypted') throw new Error(`resume ${stopAt} left ${headerKind(session.file)}`)
    const paths = migrationPaths(session.file)
    if (fs.existsSync(paths.backup)) throw new Error(`resume ${stopAt} kept the plaintext backup`)
    session.boot.close()
    fs.rmSync(dir, { recursive: true, force: true })
    if (stopAt && first !== stopAt && !(stopAt === 'TARGET_COPYING' && first === 'TARGET_COPYING')) {
      throw new Error(`expected stop ${stopAt} but got ${first}`)
    }
  }

  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-guard-'))
  const encrypted = path.join(guardDir, 'already.db')
  fs.writeFileSync(encrypted, Buffer.from('EVFS1-not-empty-file!!'))
  const { canCreateEmpty } = require('../../apps/desktop/src/main/utils/encryptedMigrate.cjs')
  if (canCreateEmpty(encrypted)) throw new Error('encrypted file was treated as creatable')
  fs.rmSync(guardDir, { recursive: true, force: true })
  return { ok: true }
}

if (require.main === module) {
  run()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`)
      process.exit(1)
    })
}

module.exports = { run }
