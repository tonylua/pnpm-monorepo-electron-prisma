const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const { DatabaseSync, backup } = require('node:sqlite')

const repoRoot = path.resolve(__dirname, '../..')
const dllPath = path.join(repoRoot, 'apps/desktop/resources/encrypted_vfs.dll')
const requireCommon = createRequire(path.join(repoRoot, 'packages/common/package.json'))
const marker = 'vfs-cipher-marker-7f3a'

function parseStatus(text) {
  const parsed = {}
  for (const part of String(text).split(' ')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    const numeric = Number(value)
    parsed[key] = Number.isNaN(numeric) ? value : numeric
  }
  return parsed
}

function readStatus(db) {
  return parseStatus(db.prepare('SELECT encrypted_vfs_status() AS status').get().status)
}

function register(db, filePath, key) {
  const result = db.prepare('SELECT encrypted_vfs_register_db(?, ?, ?) AS result').get(filePath, key, 'create-new')
  if (result.result !== 'ok') throw new Error(`register failed: ${result.result}`)
}

function win32Uri(filePath) {
  const uri = pathToFileURL(filePath)
  uri.searchParams.set('vfs', 'win32')
  return uri
}

function rawContains(filePath, text) {
  return fs.readFileSync(filePath).includes(Buffer.from(text))
}

function check(checks, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
}

async function openPrisma(contractPath, dbPath) {
  const sqliteModule = requireCommon('@prisma/orm-sqlite/runtime')
  const sqlite = sqliteModule.default || sqliteModule
  const db = sqlite({ contractJson: require(contractPath), middleware: [] })
  const runtime = await db.connect({ path: dbPath })
  return { db, runtime }
}

async function verify() {
  const checks = []
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'encrypted-vfs-'))
  const key = crypto.randomBytes(32)
  const opened = []
  let bootstrap = null

  try {
    check(checks, 'dll exists', fs.existsSync(dllPath), dllPath)
    bootstrap = new DatabaseSync(':memory:', { allowExtension: true })
    bootstrap.loadExtension(dllPath)
    bootstrap.enableLoadExtension(false)
    const activated = bootstrap.prepare('SELECT encrypted_vfs_activate() AS name').get()
    const initial = readStatus(bootstrap)
    check(
      checks,
      'vfs active and encrypting',
      activated.name === 'encrypted-vfs' && initial.default === 'encrypted-vfs' && initial.encryption === 1,
      initial
    )

    const directPath = path.join(tempDir, 'direct.db')
    register(bootstrap, directPath, key)
    const direct = new DatabaseSync(directPath)
    opened.push(direct)
    direct.exec('CREATE TABLE marker(id INTEGER PRIMARY KEY, note TEXT)')
    const deleteMode = direct.prepare('PRAGMA journal_mode').get()
    let walError = null
    try {
      direct.exec('PRAGMA journal_mode = WAL')
    } catch (error) {
      walError = error
    }
    check(
      checks,
      'journal mode stays DELETE',
      deleteMode.journal_mode === 'delete' && walError instanceof Error,
      walError && walError.message
    )
    direct.exec('BEGIN')
    direct.exec(`INSERT INTO marker(note) VALUES ('${marker}')`)
    const journalPath = `${directPath}-journal`
    const journalCipher = fs.existsSync(journalPath) && !rawContains(journalPath, marker)
    direct.exec('COMMIT')
    direct.close()
    opened.pop()

    const raw = fs.readFileSync(directPath)
    check(checks, 'file header is EVFS1', raw.subarray(0, 5).toString('utf8') === 'EVFS1', raw.subarray(0, 8).toString('utf8'))
    check(checks, 'marker absent from database file', !raw.includes(Buffer.from(marker)), raw.length)
    check(checks, 'marker absent from journal', journalCipher, fs.existsSync(journalPath))

    const again = new DatabaseSync(directPath)
    const note = again.prepare('SELECT note FROM marker').get().note
    again.close()
    check(checks, 'reopen reads marker', note === marker, note)

    const unregistered = path.join(tempDir, 'unregistered.db')
    fs.copyFileSync(directPath, unregistered)
    let unregisteredError = null
    let unregisteredDb = null
    try {
      unregisteredDb = new DatabaseSync(unregistered)
      unregisteredDb.prepare('SELECT note FROM marker').get()
    } catch (error) {
      unregisteredError = error
    } finally {
      if (unregisteredDb) unregisteredDb.close()
    }
    check(checks, 'unregistered copy does not open', unregisteredError instanceof Error, unregisteredError && unregisteredError.message)

    const wrongPath = path.join(tempDir, 'wrong-key.db')
    fs.copyFileSync(directPath, wrongPath)
    register(bootstrap, wrongPath, crypto.randomBytes(32))
    let wrongKeyError = null
    let wrongDb = null
    try {
      wrongDb = new DatabaseSync(wrongPath)
      wrongDb.prepare('SELECT note FROM marker').get()
    } catch (error) {
      wrongKeyError = error
    } finally {
      if (wrongDb) wrongDb.close()
    }
    check(checks, 'wrong key fails', wrongKeyError instanceof Error, wrongKeyError && wrongKeyError.message)

    const tamperedPath = path.join(tempDir, 'tampered.db')
    const tampered = fs.readFileSync(directPath)
    tampered[tampered.length - 20] ^= 0xff
    fs.writeFileSync(tamperedPath, tampered)
    register(bootstrap, tamperedPath, key)
    let tamperError = null
    let tamperedDb = null
    try {
      tamperedDb = new DatabaseSync(tamperedPath)
      tamperedDb.prepare('SELECT note FROM marker').get()
    } catch (error) {
      tamperError = error
    } finally {
      if (tamperedDb) tamperedDb.close()
    }
    check(checks, 'tampered ciphertext fails', tamperError instanceof Error, tamperError && tamperError.message)

    const plainPath = path.join(tempDir, 'legacy.db')
    const plain = new DatabaseSync(win32Uri(plainPath))
    plain.exec('CREATE TABLE marker(id INTEGER PRIMARY KEY, note TEXT)')
    plain.exec(`INSERT INTO marker(note) VALUES ('${marker}')`)
    plain.close()
    check(checks, 'legacy file starts as sqlite', fs.readFileSync(plainPath).subarray(0, 15).toString('utf8') === 'SQLite format 3', null)
    const migratedPath = path.join(tempDir, 'migrated.db')
    register(bootstrap, migratedPath, key)
    const source = new DatabaseSync(win32Uri(plainPath))
    await backup(source, migratedPath)
    source.close()
    const migrated = new DatabaseSync(migratedPath)
    const migratedNote = migrated.prepare('SELECT note FROM marker').get().note
    migrated.close()
    check(checks, 'backup into encrypted file keeps rows', migratedNote === marker, migratedNote)
    check(
      checks,
      'migrated file is ciphertext',
      fs.readFileSync(migratedPath).subarray(0, 5).toString('utf8') === 'EVFS1' && !rawContains(migratedPath, marker),
      null
    )

    const mainPath = path.join(tempDir, 'prisma-main.db')
    register(bootstrap, mainPath, key)
    const beforeMain = readStatus(bootstrap).encrypted_opens
    const main = await openPrisma(path.join(repoRoot, 'packages/common/src/generated/db_client/contract.json'), mainPath)
    opened.push(main)
    await main.db.transaction(async () => {})
    const afterMain = readStatus(bootstrap).encrypted_opens
    if (main.db.close) await main.db.close()
    opened.pop()
    const mainRaw = fs.readFileSync(mainPath)
    check(checks, 'prisma main and transaction open ciphertext', afterMain >= beforeMain + 2 && mainRaw.subarray(0, 5).toString('utf8') === 'EVFS1', {
      before: beforeMain,
      after: afterMain
    })

    const controlPath = path.join(tempDir, 'control.db')
    register(bootstrap, controlPath, key)
    const beforeControl = readStatus(bootstrap).encrypted_opens
    const { createSqliteControlClient } = requireCommon('@prisma/orm-sqlite/control')
    const control = createSqliteControlClient()
    await control.connect(controlPath)
    if (control.close) await control.close()
    const afterControl = readStatus(bootstrap).encrypted_opens
    check(
      checks,
      'control client opens ciphertext',
      afterControl >= beforeControl + 1 && fs.readFileSync(controlPath).subarray(0, 5).toString('utf8') === 'EVFS1',
      { before: beforeControl, after: afterControl }
    )

    // The source repo also verified a second (SmartCopy) database here. This
    // repo has a single database, so that check is dropped rather than ported.
  } finally {
    for (const item of opened.reverse()) {
      try {
        if (item && item.db && item.db.close) await item.db.close()
        else if (item && item.close) item.close()
      } catch {
        // Keep the recorded checks.
      }
    }
    if (bootstrap) {
      try {
        bootstrap.close()
      } catch {
        // The extension stays loaded for this process.
      }
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // A failed open can leave a Windows handle until the next GC.
    }
  }

  return {
    ok: checks.every((item) => item.ok),
    dllPath,
    runtime: { electron: process.versions.electron || null, node: process.versions.node, arch: process.arch },
    checks
  }
}

module.exports = { verify }
