import path from 'node:path'
import { app } from 'electron'
import type { IContextDB, IFacade } from '@app/common'
import * as commonFacade from '@app/common'
import { isDev } from './isDev'

const { DB_FILE_NAME } = commonFacade as IFacade

export const dbContext: IContextDB = {
  getDBPath: () =>
    isDev
      ? path.posix.resolve(`../../packages/common/src/storage/${DB_FILE_NAME}`)
      : path.join(app.getPath('userData'), DB_FILE_NAME),

  getPrismaEnginesDir: () => app.getAppPath().replace('app.asar', ''),

  getPrismaEnginesBase: () =>
    isDev
      ? '../../packages/common/node_modules/@prisma/engines/'
      : path.resolve(app.getAppPath().replace('app.asar', ''), 'prisma/'),

  getSchemaPrismaPath: () =>
    isDev
      ? path.join(
          app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
          '../../packages/common/src/prisma/',
          'schema.prisma'
        )
      : path.resolve(app.getAppPath().replace('app.asar', ''), 'prisma/schema.prisma'),

  getPrismaPath: () =>
    isDev
      ? void 0
      : path.resolve(
          app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
          'node_modules/prisma/build/index.js'
        )
}

console.log(
  [
    '%c 💻 desktop db context ⌨',
    isDev,
    dbContext.getPrismaPath?.(),
    dbContext.getSchemaPrismaPath?.(),
    dbContext.getDBPath(),
    dbContext.getPrismaEnginesBase?.()
  ].join('\n'),
  'color: red;'
)
