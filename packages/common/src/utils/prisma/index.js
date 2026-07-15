const { join, resolve } = require('path')
const { PrismaClient } = require('../../generated/db_client/client')
const { PrismaNodeSqlite } = require('./nodeSqliteAdapter')
const getDBConstants = require('./dbConstants')

/**
 * @type {import('../../types').TypeGetPrisma}
 */
function getPrisma(ctx) {
  if ('prisma' in global) return global.prisma

  let isDev = process.env.NODE_ENV === 'development'
  if (!process.env.IS_WEB) isDev ||= global?.isElectronDev

  let envPath

  if (typeof ctx.getEnvPath === 'function') {
    envPath = ctx.getEnvPath()
  } else if (isDev) {
    envPath = resolve(__dirname, '.env.dev')
  } else {
    envPath = join(process.resourcesPath, 'prisma/.env')
  }
  require('dotenv').config({ path: envPath })

  const { dbUrl } = getDBConstants(ctx) // 晚于env调用

  // Prisma 7 is Rust-free: connect through a driver adapter instead of a query
  // engine binary. We use our node:sqlite adapter (Node 24 / Electron 43 built-in),
  // so the packaged app ships zero native SQLite dependencies. See nodeSqliteAdapter.js.
  const adapter = new PrismaNodeSqlite({ url: dbUrl })

  const option = {
    adapter,
    log: ['error', 'info', 'warn']
  }
  console.log(['%c ￥@app/common::getPrisma￥', envPath, dbUrl].join('\n'), 'color: yellow')

  const prisma = new PrismaClient(option)

  global.prisma = prisma
  return prisma
}

module.exports = getPrisma
