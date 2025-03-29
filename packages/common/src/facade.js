const getPrisma = require('./utils/prisma')
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
  DB_FILE_NAME: 'myDb.db'
}

module.exports = Facade
