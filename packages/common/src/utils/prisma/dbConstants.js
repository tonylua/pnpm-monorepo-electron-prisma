const path = require('path')

/**
 * Prisma 7 is Rust-free: there is no query-engine .dll.node and no schema-engine
 * .exe to locate, so this only resolves the sqlite file path and its file: URL.
 * The runtime connects through the node:sqlite driver adapter (see index.js);
 * migrations are applied by executing migration.sql directly (runPrismaCommand.js).
 *
 * @type {import('../../types').TypeGetDBConstants}
 */
function getDBConstants(ctx) {
  const isDev = process.env.NODE_ENV === 'development'

  const dbPath = ctx.getDBPath()
  const dbUrl = process.env.DATABASE_URL || 'file:' + dbPath
  process.env.DATABASE_URL = dbUrl

  return {
    isDev,
    dbPath,
    dbUrl
  }
}

module.exports = getDBConstants
