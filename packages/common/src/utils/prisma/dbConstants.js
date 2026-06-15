const path = require('path')

/**
 * @type {import('../../types').TypeGetDBConstants}
 */
function getDBConstants(ctx) {
  const isDev = process.env.NODE_ENV === 'development'

  const dbPath = ctx.getDBPath()
  const dbUrl = process.env.DATABASE_URL || 'file:' + dbPath
  process.env.DATABASE_URL = dbUrl

  const getEnginesPath = (fileName) => path.join(ctx.getPrismaEnginesBase?.(), fileName)
  const executables = {
    migrationEngine: getEnginesPath('schema-engine-windows.exe'),
    queryEngine: getEnginesPath('query_engine-windows.dll.node')
  }

  const extraResourcesPath = ctx.getPrismaEnginesDir()
  const { migrationEngine: m, queryEngine: q } = executables

  if (!global.hasLastMigWarned) {
    console.log('%c ⚠!!! 每次创建 migration 后更新 latestMigration 常量 !!!⚠', 'color: yellow')
    global.hasLastMigWarned = true
  }
  return {
    isDev,
    dbPath,
    dbUrl,
    latestMigration: '20250330045745_init',
    mePath: path.isAbsolute(m) ? m : path.join(extraResourcesPath, m),
    qePath: path.isAbsolute(q) ? q : path.join(extraResourcesPath, q),
    prismaPath: ctx.getPrismaPath?.()
  }
}

module.exports = getDBConstants
