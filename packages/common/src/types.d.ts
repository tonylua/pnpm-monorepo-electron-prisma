import { PrismaClient, Prisma } from '@prisma/client'
import { DBModelsGetterMap } from './models'

export interface IContextDB {
  getDBPath(): string
  getPrismaEnginesDir(): string
  getPrismaEnginesBase?: () => string
  getSchemaPrismaPath?: () => string
  getPrismaPath?: () => string | undefined
  getEnvPath?: () => string
}

export interface PrismaMigration {
  id: string
  checksum: string
  finished_at: string
  migration_name: string
  logs: string
  rolled_back_at: string
  started_at: string
  applied_steps_count: string
}

export type TypeDBConstants = {
  isDev: boolean
  dbPath: string
  dbUrl: string
  latestMigration: string
  mePath: string
  qePath: string
  prismaPath?: string
}

export type TypeGetPrisma = (ctx: IContextDB) => PrismaClient

export type TypeGetDBConstants = (ctx: IContextDB) => TypeDBConstants

export type TypeDBModels = {
  [K in Prisma.ModelName as `get${K}Model`]: DBModelsGetterMap[K]
}

export type RunPrismaCmdParam = {
  command: string[]
  ctx: IContextDB
  prismaPath?: string
}
export type TypeRunPrismaCommand = (param: RunPrismaCmdParam) => Promise<number>

export interface IFacade {
  getPrisma: TypeGetPrisma
  getDBConstants: TypeGetDBConstants
  DBModels: TypeDBModels
  DB_FILE_NAME: string;
  runPrismaCommand: TypeRunPrismaCommand
}
