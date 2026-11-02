// Probe: can the prebuilt encrypted_vfs.dll load into this Electron's SQLite?
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync, backup } = require('node:sqlite')

const dll = process.argv[2]
if (!dll || !fs.existsSync(dll)) {
  console.error('usage: electron probe-load.cjs <abs path to encrypted_vfs.dll>')
  process.exit(1)
}

const out = {}
const db = new DatabaseSync(':memory:', { allowExtension: true })
out.sqlite = db.prepare('select sqlite_version() v').get().v
try {
  db.loadExtension(dll)
  out.load = 'ok'
} catch (error) {
  out.load = `FAILED: ${error.message}`
  console.log(JSON.stringify(out, null, 2))
  process.exit(2)
}

try {
  out.status = db.prepare('SELECT encrypted_vfs_status() AS s').get().s
} catch (error) {
  out.status = `FAILED: ${error.message}`
}

// Full round trip: register a fresh db, activate, write, close, inspect header.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evfs-probe-'))
const target = path.join(dir, 'probe.db')
const key = Buffer.alloc(32, 7)
try {
  out.register = db
    .prepare('SELECT encrypted_vfs_register_db(?, ?, ?) AS r')
    .get(target, key, 'create-new').r
  out.activate = db.prepare('SELECT encrypted_vfs_activate() AS a').get().a
} catch (error) {
  out.register = `FAILED: ${error.message}`
  console.log(JSON.stringify(out, null, 2))
  process.exit(3)
}

try {
  const work = new DatabaseSync(target)
  work.exec('PRAGMA journal_mode=DELETE')
  work.exec('CREATE TABLE t (a TEXT)')
  work.prepare('INSERT INTO t VALUES (?)').run('secret-marker-xyz')
  out.readBack = work.prepare('SELECT a FROM t').get().a
  work.close()
  const header = Buffer.alloc(16)
  const fd = fs.openSync(target, 'r')
  fs.readSync(fd, header, 0, 16, 0)
  fs.closeSync(fd)
  out.header = header.toString('utf8').replace(/\0/g, '.')
  const whole = fs.readFileSync(target)
  out.plaintextLeak = whole.includes('secret-marker-xyz')
  out.size = whole.length
} catch (error) {
  out.roundTrip = `FAILED: ${error.message}`
}

try {
  db.prepare('SELECT encrypted_vfs_shutdown(?) AS s').get('force')
  out.shutdown = 'ok'
} catch (error) {
  out.shutdown = `FAILED: ${error.message}`
}

console.log(JSON.stringify(out, null, 2))
console.log('probe dir:', dir)
