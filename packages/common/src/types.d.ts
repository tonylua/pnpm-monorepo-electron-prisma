import { PrismaClient, Prisma, Account, Thread, ThreadMessage } from './generated/db_client/client'
import { DBModelsGetterMap } from './models'

// Re-export the generated client type so consumers import it from '@app/common'
// instead of reaching into the generated output directory.
export type { PrismaClient, Prisma, Account, Thread, ThreadMessage }

export interface IContextDB {
  getDBPath(): string
  // Directory containing the Prisma migration folders (each with a migration.sql).
  // In dev this is the schema sibling; in a packaged app it is shipped via
  // electron-builder extraResources to resources/prisma/migrations.
  getMigrationsDir?: () => string
  getSchemaPrismaPath?: () => string
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
}

export type TypeGetPrisma = (ctx: IContextDB) => PrismaClient

export type TypeGetDBConstants = (ctx: IContextDB) => TypeDBConstants

export type TypeDBModels = {
  [K in Prisma.ModelName as `get${K}Model`]: DBModelsGetterMap[K]
}

export type RunPrismaCmdParam = {
  ctx: IContextDB
}
export type TypeRunPrismaCommand = (param: RunPrismaCmdParam) => Promise<number>

export interface IFacade {
  getPrisma: TypeGetPrisma
  getDBConstants: TypeGetDBConstants
  DBModels: TypeDBModels
  DB_FILE_NAME: string
  runPrismaCommand: TypeRunPrismaCommand
}
