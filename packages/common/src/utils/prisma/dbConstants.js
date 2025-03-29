const path = require('path')

function getPlatformName() {
  const isDarwin = process.platform === 'darwin'
  if (isDarwin && process.arch === 'arm64') {
    return process.platform + 'Arm64'
  }
  return process.platform
}

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
    win32: {
      migrationEngine: getEnginesPath('schema-engine-windows.exe'),
      queryEngine: getEnginesPath('query_engine-windows.dll.node')
    },
    linux: {
      migrationEngine: getEnginesPath('schema-engine-debian-openssl-1.1.x'),
      queryEngine: getEnginesPath('libquery_engine-debian-openssl-1.1.x.so.node')
    },
    darwin: {
      migrationEngine: getEnginesPath('schema-engine-darwin'),
      queryEngine: getEnginesPath('libquery_engine-darwin.dylib.node')
    },
    darwinArm64: {
      migrationEngine: getEnginesPath('schema-engine-darwin-arm64'),
      queryEngine: getEnginesPath('libquery_engine-darwin-arm64.dylib.node')
    }
  }[getPlatformName()]

  // 受到 package.json/electron-builder.yml 中 extraResources 字段的影响
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
    latestMigration: '20250327030021_init',
    mePath: path.isAbsolute(m) ? m : path.join(extraResourcesPath, m),
    qePath: path.isAbsolute(q) ? q : path.join(extraResourcesPath, q),
    prismaPath: ctx.getPrismaPath?.()
  }
}

module.exports = getDBConstants
