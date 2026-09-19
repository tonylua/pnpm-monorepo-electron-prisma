// utils/prisma/index.js is ESM; esbuild wraps it as { default, getPrisma, ... }
// when bundling to CJS. Extract the actual function from .getPrisma or .default.
const prismaModule = require('./utils/prisma')
const getPrisma = prismaModule.getPrisma || prismaModule.default || prismaModule
const runPrismaCommand = require('./utils/prisma/runPrismaCommand')
const getDBConstants = require('./utils/prisma/dbConstants')
const DBModels = require('./models')

/**
 * @type {import('./types').IFacade}
 */
const Facade = {
  getPrisma,
  runPrismaCommand,
  getDBConstants,
  DBModels,
  DB_FILE_NAME: 'myDb.db',
}

module.exports = Facade
