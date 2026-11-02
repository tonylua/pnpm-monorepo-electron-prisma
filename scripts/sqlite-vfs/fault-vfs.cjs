const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const repoRoot = path.resolve(__dirname, '../..')
const dllPath = path.join(repoRoot, 'apps/desktop/resources/encrypted_vfs.dll')

function load(boot, file, key) {
  boot.prepare('SELECT encrypted_vfs_register_db(?, ?, ?)').get(file, key, 'create-new')
}

function arm(boot, mode, skip) {
  boot.prepare('SELECT encrypted_vfs_test_fault(?, ?)').get(mode, skip)
}

function openDb(dir) {
  const boot = new DatabaseSync(':memory:', { allowExtension: true })
  boot.loadExtension(dllPath)
  boot.prepare('SELECT encrypted_vfs_activate()').get()
  const file = path.join(dir, 't.db')
  const key = crypto.randomBytes(32)
  load(boot, file, key)
  return { boot, file, key }
}

function committed(file, key, boot) {
  load(boot, file, key)
  const db = new DatabaseSync(file)
  try {
    const row = db.prepare('SELECT note FROM t WHERE note = ?').get('keep')
    const integrity = db.prepare('PRAGMA integrity_check').get()
    return { row: row && row.note, integrity: integrity.integrity_check }
  } finally {
    db.close()
  }
}

function tearSlot(file) {
  const data = fs.readFileSync(file)
  data.fill(0, 128, 128 + 44)
  fs.writeFileSync(file, data)
}

function tearBlock(file) {
  const data = fs.readFileSync(file)
  data[data.length - 1] ^= 0xff
  fs.writeFileSync(file, data)
}

function run() {
  if (!fs.existsSync(dllPath)) throw new Error(`missing dll ${dllPath}`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-fault-'))
  const base = openDb(dir)
  const db = new DatabaseSync(base.file)
  db.exec('CREATE TABLE t(note TEXT)')
  db.exec("INSERT INTO t(note) VALUES ('keep')")
  db.close()

  const slotCopy = path.join(dir, 'slot.db')
  fs.copyFileSync(base.file, slotCopy)
  tearSlot(slotCopy)
  const slotRead = committed(slotCopy, base.key, base.boot)
  if (slotRead.row !== 'keep' || slotRead.integrity !== 'ok') {
    throw new Error(`torn superblock did not keep the older slot: ${JSON.stringify(slotRead)}`)
  }

  const blockCopy = path.join(dir, 'block.db')
  fs.copyFileSync(base.file, blockCopy)
  tearBlock(blockCopy)
  let blockFailed = false
  try {
    committed(blockCopy, base.key, base.boot)
  } catch (error) {
    blockFailed = /I\/O|disk|not a database/i.test(error.message)
  }
  if (!blockFailed) throw new Error('torn data block returned plaintext')

  for (const mode of ['write-ioerr', 'write-full', 'sync-ioerr']) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-fault-'))
    const opened = openDb(scratch)
    const live = new DatabaseSync(opened.file)
    live.exec('CREATE TABLE t(note TEXT)')
    live.exec("INSERT INTO t(note) VALUES ('keep')")
    arm(opened.boot, mode, 0)
    let failed = false
    try {
      live.exec("INSERT INTO t(note) VALUES ('new')")
    } catch {
      failed = true
    }
    arm(opened.boot, 'clear', 0)
    live.close()
    const after = committed(opened.file, opened.key, opened.boot)
    if (!failed || after.row !== 'keep' || after.integrity !== 'ok') {
      throw new Error(`${mode} leaked or dropped the committed row: ${JSON.stringify(after)} failed=${failed}`)
    }
    opened.boot.close()
  }

  const modes = ['write-ioerr', 'write-full', 'write-short', 'sync-ioerr']
  for (let seed = 0; seed < 1000; seed += 1) {
    const mode = modes[seed % modes.length]
    const skip = seed % 5
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-seed-'))
    const opened = openDb(scratch)
    const live = new DatabaseSync(opened.file)
    live.exec('CREATE TABLE t(note TEXT)')
    live.exec("INSERT INTO t(note) VALUES ('keep')")
    arm(opened.boot, mode, skip)
    let failed = false
    try {
      live.exec('BEGIN')
      live.exec(`INSERT INTO t(note) VALUES ('new-${seed}')`)
      live.exec('COMMIT')
    } catch {
      failed = true
      try {
        live.exec('ROLLBACK')
      } catch {
        // The fault may already have closed the transaction.
      }
    }
    arm(opened.boot, 'clear', 0)
    live.close()
    let after = null
    let openError = null
    try {
      after = committed(opened.file, opened.key, opened.boot)
    } catch (error) {
      openError = error
    }
    opened.boot.close()
    fs.rmSync(scratch, { recursive: true, force: true })
    if (openError) {
      if (!/I\/O|disk|not a database|unable to open/i.test(openError.message)) {
        throw new Error(`seed ${seed} ${mode} unexpected ${openError.message}`)
      }
      continue
    }
    if (after.row !== 'keep' || after.integrity !== 'ok') {
      throw new Error(`seed ${seed} ${mode} lost committed data ${JSON.stringify(after)}`)
    }
  }

  arm(base.boot, 'clear', 0)
  base.boot.prepare('SELECT encrypted_vfs_shutdown(?)').get('force')
  let shut = false
  try {
    new DatabaseSync(base.file).close()
  } catch (error) {
    shut = /I\/O|disk|unable to open/i.test(error.message)
  }
  if (!shut) throw new Error('shutdown left the key usable')
  base.boot.close()
  fs.rmSync(dir, { recursive: true, force: true })
  return { ok: true, seeds: 1000 }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(run())}\n`)
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  }
}

module.exports = { run }
