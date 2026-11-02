// Migrates a COPY of the repo's real dev database through the same state
// machine encryptedSqlite uses, then reopens it with Prisma's own runtime.
// Proves the plaintext -> EVFS1 upgrade preserves real data, without touching
// the original file.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const { DatabaseSync, backup } = require('node:sqlite')
const {
  databaseDigest,
  headerKind,
  migrateDatabase
} = require('../../apps/desktop/src/main/utils/encryptedMigrate.cjs')

const repoRoot = path.resolve(__dirname, '../..')
const dllPath = path.join(repoRoot, 'apps/desktop/resources/encrypted_vfs.dll')
const sourceDb = path.join(repoRoot, 'packages/common/src/storage/myDb.db')
const contractPath = path.join(
  repoRoot,
  'packages/common/src/generated/db_client/contract.json'
)
const requireCommon = createRequire(path.join(repoRoot, 'packages/common/package.json'))

function win32Uri(filePath) {
  const uri = pathToFileURL(filePath)
  uri.searchParams.set('vfs', 'win32')
  return uri
}

function openDigest(open) {
  const db = open()
  try {
    return databaseDigest(db)
  } finally {
    db.close()
  }
}

async function main() {
  const out = {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evfs-real-'))
  const file = path.join(dir, 'myDb.db')
  fs.copyFileSync(sourceDb, file)

  out.before = headerKind(file)
  const plainDigest = openDigest(() => new DatabaseSync(win32Uri(file)))
  out.tablesBefore = plainDigest.counts
  out.integrityBefore = plainDigest.integrity

  const boot = new DatabaseSync(':memory:', { allowExtension: true })
  boot.loadExtension(dllPath)
  boot.enableLoadExtension(false)
  boot.prepare('SELECT encrypted_vfs_activate()').get()
  const key = crypto.randomBytes(32)
  const register = (target) => {
    const row = boot
      .prepare('SELECT encrypted_vfs_register_db(?, ?, ?) AS result')
      .get(target, key, 'open-existing')
    if (row.result !== 'ok') throw new Error(`register failed: ${row.result}`)
  }

  const replaceFile = async (from, to) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.renameSync(from, to)
        return
      } catch (error) {
        if (attempt === 19) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  out.state = await migrateDatabase(file, {
    async verifyEncrypted(target) {
      register(target)
      const digest = openDigest(() => new DatabaseSync(target))
      if (digest.integrity !== 'ok') throw new Error('DATABASE_AUTH_FAILED')
    },
    async digestPlain(target) {
      return openDigest(() => new DatabaseSync(win32Uri(target)))
    },
    async digestEncrypted(target) {
      register(target)
      return openDigest(() => new DatabaseSync(target))
    },
    async copy(source, destination) {
      fs.rmSync(destination, { force: true })
      register(destination)
      const plain = new DatabaseSync(win32Uri(source))
      try {
        await backup(plain, destination)
      } finally {
        plain.close()
      }
    },
    replaceFile
  })

  out.after = headerKind(file)
  register(file)
  const encDigest = openDigest(() => new DatabaseSync(file))
  out.tablesAfter = encDigest.counts
  out.integrityAfter = encDigest.integrity
  out.digestMatches = plainDigest.digest === encDigest.digest
  out.siblingsCleaned =
    !fs.existsSync(`${file}.plaintext-bak`) &&
    !fs.existsSync(`${file}.evfs-migrate.json`)

  // Real rows must not be readable in the raw bytes.
  const raw = fs.readFileSync(file)
  out.headerBytes = raw.subarray(0, 5).toString('utf8')

  // Reopen through this repo's own getPrisma (the built common facade), which
  // is the exact path the app uses, rather than a hand-rolled client.
  const { getPrisma } = requireCommon('./dist/index.js')
  const prisma = await getPrisma({ getDBPath: () => file })
  out.prismaAccounts = (await prisma.Account.where({})).length
  out.prismaThreads = (await prisma.Thread.where({})).length
  out.prismaMessages = (await prisma.ThreadMessage.where({})).length
  if (prisma.db && prisma.db.close) await prisma.db.close()

  boot.prepare('SELECT encrypted_vfs_shutdown(?)').get('force')
  boot.close()
  key.fill(0)
  fs.rmSync(dir, { recursive: true, force: true })

  out.ok =
    out.before === 'plaintext' &&
    out.after === 'encrypted' &&
    out.state === 'ACTIVE' &&
    out.digestMatches === true &&
    out.integrityAfter === 'ok' &&
    out.siblingsCleaned === true &&
    out.headerBytes === 'EVFS1'
  return out
}

main()
  .then((out) => {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    process.exit(out.ok ? 0 : 1)
  })
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`)
    process.exit(1)
  })
