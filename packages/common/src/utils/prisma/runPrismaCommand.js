const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const getDBConstants = require('./dbConstants')

// Prisma 7 is Rust-free: there is no schema-engine binary and no way to fork the
// old `prisma migrate deploy` CLI in a packaged app without shipping the engines.
// Instead we apply the generated migration.sql files directly through node:sqlite,
// tracking applied migrations in the standard `_prisma_migrations` table so that
// db.ts's `select * from _prisma_migrations` check keeps working unchanged.

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                    TEXT PRIMARY KEY NOT NULL,
  "checksum"              TEXT NOT NULL,
  "finished_at"           DATETIME,
  "migration_name"        TEXT NOT NULL,
  "logs"                  TEXT,
  "rolled_back_at"        DATETIME,
  "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`

/**
 * Locate the migrations directory. In dev it lives next to the schema; in a
 * packaged app it is shipped via electron-builder extraResources to
 * resources/prisma/migrations.
 */
function resolveMigrationsDir(ctx) {
  if (typeof ctx.getMigrationsDir === 'function') {
    const dir = ctx.getMigrationsDir()
    if (dir && fs.existsSync(dir)) return dir
  }
  // dev fallback: schema sibling
  if (typeof ctx.getSchemaPrismaPath === 'function') {
    const schemaPath = ctx.getSchemaPrismaPath()
    if (schemaPath) {
      const dir = path.join(path.dirname(schemaPath), 'migrations')
      if (fs.existsSync(dir)) return dir
    }
  }
  // packaged fallback
  if (process.resourcesPath) {
    const dir = path.join(process.resourcesPath, 'prisma', 'migrations')
    if (fs.existsSync(dir)) return dir
  }
  throw new Error('runPrismaCommand: could not locate migrations directory')
}

/** Read migration folders in lexicographic (== chronological) order. */
function listMigrations(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => {
      const full = path.join(migrationsDir, name)
      return (
        fs.statSync(full).isDirectory() &&
        fs.existsSync(path.join(full, 'migration.sql'))
      )
    })
    .sort()
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
}

/**
 * Apply all pending migrations directly against the SQLite database.
 * Idempotent: migrations already recorded in `_prisma_migrations` are skipped.
 *
 * @type {import('../../types').TypeRunPrismaCommand}
 */
async function runPrismaCommand(param) {
  const { ctx } = param
  const { dbPath, dbUrl } = getDBConstants(ctx)

  const target = dbPath || dbUrl.replace(/^file:/, '')
  const migrationsDir = resolveMigrationsDir(ctx)
  const migrations = listMigrations(migrationsDir)

  const db = new DatabaseSync(target)
  try {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(MIGRATIONS_TABLE_DDL)

    const appliedRows = db
      .prepare('SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL')
      .all()
    const applied = new Set(appliedRows.map((r) => r.migration_name))

    for (const name of migrations) {
      if (applied.has(name)) {
        console.log(`  ✓ migration already applied: ${name}`)
        continue
      }
      const sqlPath = path.join(migrationsDir, name, 'migration.sql')
      const sql = fs.readFileSync(sqlPath, 'utf8')
      console.log(`  → applying migration: ${name}`)

      const startedAt = new Date().toISOString()
      db.exec('BEGIN')
      try {
        db.exec(sql)
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
           VALUES (?, ?, ?, ?, NULL, ?, 1)`
        ).run(crypto.randomUUID(), checksum(sql), new Date().toISOString(), name, startedAt)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw new Error(`migration ${name} failed: ${e.message}`)
      }
    }

    db.exec('PRAGMA foreign_keys = ON')
    return 0
  } finally {
    db.close()
  }
}

module.exports = runPrismaCommand
