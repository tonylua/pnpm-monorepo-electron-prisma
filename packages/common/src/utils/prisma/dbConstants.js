const path = require('path')

/**
 * @type {import('../../types').TypeGetDBConstants}
 */
function getDBConstants(ctx) {
  const isDev = process.env.NODE_ENV === 'development'

  const dbPath = ctx.getDBPath()
  const dbUrl = process.env.DATABASE_URL || 'file:' + dbPath
  process.env.DATABASE_URL = dbUrl

  if (!global.hasLastMigWarned) {
    console.log('%c ⚠!!! 每次创建 migration 后更新 latestMigration 常量 !!!⚠', 'color: yellow')
    global.hasLastMigWarned = true
  }

  return {
    isDev,
    dbPath,
    dbUrl,
    // Bump this after every `prisma migrate dev` so initDB knows a newer
    // migration needs applying. Must match the newest folder in
    // src/prisma/migrations (suffix compared in db.ts initDB).
    latestMigration: '20250330045745_init'
  }
}

module.exports = getDBConstants
