const { join, resolve } = require('path')
const { PrismaClient } = require('@prisma/client')
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

  const { dbUrl, qePath } = getDBConstants(ctx) // 晚于env调用
  const option = {
    log: ['error', 'info', 'warn'],
    __internal: {
      engine: {
        binaryPath: qePath
      }
    }
  }
  if (!isDev) {
    option.datasources = {
      db: {
        url: dbUrl
      }
    }
  }
  console.log(
    ['%c ￥@app/common::getPrisma￥', envPath, dbUrl, qePath].join('\n'),
    'color: yellow'
  )

  const prisma = new PrismaClient(option)

  global.prisma = prisma
  return prisma
}

module.exports = getPrisma
