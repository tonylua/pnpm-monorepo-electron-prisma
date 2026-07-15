const getPrisma = require('./utils/prisma')
const runPrismaCommand = require('./utils/prisma/runPrismaCommand')
const getDBConstants = require('./utils/prisma/dbConstants')
const DBModels = require('./models')

// Re-export the generated Prisma 7 client (ESM/TS). esbuild inlines it into the
// bundled CJS dist, so consumers (desktop main process) get PrismaClient/Prisma
// from @app/common directly — no separate `db_client` link package at runtime.
const { PrismaClient, Prisma } = require('./generated/db_client/client')

/**
 * @type {import('./types').IFacade}
 */
const Facade = {
  getPrisma,
  runPrismaCommand,
  getDBConstants,
  DBModels,
  DB_FILE_NAME: 'myDb.db',
  PrismaClient,
  Prisma
}

module.exports = Facade
