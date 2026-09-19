const path = require('node:path')
const { createSqliteControlClient } = require('@prisma/orm-sqlite/control')
const getDBConstants = require('./dbConstants')
const contractJson = require('../../generated/db_client/contract.json')

// Prisma 8 ships createSqliteControlClient: a first-class programmatic migration
// API (no CLI fork needed, no reading migration.sql files). The ControlClient
// auto-detects schema diffs and applies them idempotently via dbUpdate.
//
// This replaces the v7 approach of reading migration.sql files and executing them
// via node:sqlite's DatabaseSync. See memory/prisma8-programmatic-migration-api.md.

/**
 * Locate the migrations directory. In dev it lives next to the contract; in a
 * packaged app it is shipped via electron-builder extraResources to
 * resources/prisma/migrations.
 */
function resolveMigrationsDir(ctx) {
  if (typeof ctx.getMigrationsDir === 'function') {
    const dir = ctx.getMigrationsDir()
    if (dir) return dir
  }
  // dev fallback: contract sibling
  if (typeof ctx.getSchemaPrismaPath === 'function') {
    const schemaPath = ctx.getSchemaPrismaPath()
    if (schemaPath) {
      const dir = path.join(path.dirname(schemaPath), 'migrations')
      return dir
    }
  }
  // packaged fallback
  if (process.resourcesPath) {
    const dir = path.join(process.resourcesPath, 'prisma', 'migrations')
    return dir
  }
  throw new Error('runPrismaCommand: could not locate migrations directory')
}

/**
 * Apply Prisma v8 migrations programmatically using ControlClient.
 * Idempotent: dbUpdate detects diffs and applies only what's needed.
 *
 * @type {import('../../types').TypeRunPrismaCommand}
 */
async function runPrismaCommand(param) {
  const { ctx } = param
  const { dbPath, dbUrl } = getDBConstants(ctx)

  const target = dbPath || dbUrl.replace(/^file:/, '')
  const migrationsDir = resolveMigrationsDir(ctx)

  // v8 ControlClient: programmatic migration API
  // connection can be passed to constructor OR to dbUpdate options
  const controlClient = createSqliteControlClient()

  try {
    await controlClient.connect(target)

    // dbUpdate is idempotent: auto-detects diffs from the contract and applies only what's needed.
    // mode: 'apply' executes changes; 'plan' previews without applying.
    // migrationsDir: where contract snapshots/ledger are stored (migrations/).
    const result = await controlClient.dbUpdate({
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    })

    if (!result.ok) {
      const failure = result.failure
      throw new Error(`Migration failed: ${failure.code} - ${failure.message}`)
    }

    console.log('  ✓ v8 dbUpdate completed successfully')
    return 0
  } finally {
    await controlClient.close()
  }
}

module.exports = runPrismaCommand
