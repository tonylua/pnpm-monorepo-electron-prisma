import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Runs `prisma db update` or `prisma db verify` via Electron for an encrypted
// database. On plaintext, just spawns `prisma` directly. This repo has a single
// main database (no SmartCopy), so the source repo's which/account routing is
// dropped in favor of one target resolved from package.json + storage/myDb.db.
const commonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(commonRoot, '../..')
const [command, extra] = process.argv.slice(2)

const target = {
  file: path.join(commonRoot, 'src/storage/myDb.db'),
  config: './prisma.config.ts'
}

function headerKind(filePath) {
  if (!fs.existsSync(filePath)) return 'absent'
  const stat = fs.statSync(filePath)
  if (stat.size === 0) return 'empty'
  const header = Buffer.alloc(16)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, header, 0, 16, 0)
  } finally {
    fs.closeSync(fd)
  }
  const text = header.toString('utf8')
  if (text.startsWith('SQLite format 3')) return 'plaintext'
  if (text.startsWith('EVFS1')) return 'encrypted'
  return 'unknown'
}

if (command !== 'update' && command !== 'verify') {
  process.stderr.write('usage: db-with-vfs.mjs update|verify [--no-interactive]\n')
  process.exit(1)
}

const kind = headerKind(target.file)
if (kind === 'unknown') {
  process.stderr.write(`FORMAT_UNSUPPORTED ${target.file}\n`)
  process.exit(1)
}

// Plaintext or absent: just run the CLI directly.
if (kind !== 'encrypted') {
  const args = ['exec', 'prisma', 'db', command, '--config', target.config]
  if (extra === '--no-interactive') args.push('--no-interactive')
  const result = spawnSync('pnpm', args, { cwd: commonRoot, stdio: 'inherit', shell: true })
  process.exit(result.status ?? 1)
}

// Encrypted: spawn Electron with an app context so safeStorage can decrypt the
// key file. Electron switches shift argv, so the command is passed via env.
// --user-data-dir must match the real app's (@app/desktop) so the Local State
// crypto key is correct (safeStorage is not DPAPI-direct; it's AES-GCM under a
// key kept in userData/Local State).
const requireDesktop = createRequire(path.join(repoRoot, 'apps/desktop/package.json'))
const electronPath = requireDesktop('electron')
const script = path.join(repoRoot, 'scripts/sqlite-vfs/maintain-encrypted-db.cjs')
const userDataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, '@app', 'desktop')
  : path.join(process.env.HOME, 'Library', 'Application Support', '@app', 'desktop')
const env = { ...process.env, EVFS_COMMAND: command }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(
  electronPath,
  ['--user-data-dir', userDataDir, script],
  { cwd: path.join(repoRoot, 'apps/desktop'), stdio: 'inherit', env }
)
process.exit(result.status ?? 1)
