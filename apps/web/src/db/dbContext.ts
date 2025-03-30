import path from 'node:path'
import type { IContextDB, IFacade } from '@app/common'
import * as commonFacade from '@app/common'

const isDev = process.env.NODE_ENV === 'development'
const { DB_FILE_NAME } = commonFacade as IFacade
const distDir = isDev ? path.resolve(__dirname, '../../dist') : __dirname

export const dbContext: IContextDB = {
  getDBPath: () => path.resolve(__dirname, isDev ? '../..' : './', DB_FILE_NAME),
  getPrismaEnginesDir: () => distDir,
  getPrismaEnginesBase: () => './',
  getSchemaPrismaPath: () => path.resolve(distDir, 'schema.prisma'),
  getPrismaPath: () => (isDev ? void 0 : path.resolve(distDir, 'prisma/build/index.js')),
  getEnvPath: () => path.resolve(distDir, '.env.web')
}
