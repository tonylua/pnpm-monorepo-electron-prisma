import type { Models, Contract } from './generated/db_client/contract'
import type { Models as AnalyticsModels, Contract as AnalyticsContract } from './generated/analytics_db_client/contract'
import { DBModelsGetterMap } from './models'

// Re-export the v8 generated contract types so consumers import from '@app/common'
// instead of reaching into the generated output directory.
export type { Models, Contract }
export type Account = Models.Account
export type Thread = Models.Thread
export type ThreadMessage = Models.ThreadMessage

// Analytics DB types
export type { AnalyticsModels, AnalyticsContract }
export type AnalyticsEvent = AnalyticsModels.AnalyticsEvent
export type AnalyticsMeta = AnalyticsModels.AnalyticsMeta

// v8 doesn't have Prisma.ModelName; create a compatible namespace for existing code
export namespace Prisma {
  export type ModelName = 'Account' | 'Thread' | 'ThreadMessage'
}

export interface IContextDB {
  getDBPath(): string
  // Directory containing the Prisma migration folders.
  // In dev this is the contract sibling; in a packaged app it is shipped via
  // electron-builder extraResources to resources/prisma/migrations.
  getMigrationsDir?: () => string
  getSchemaPrismaPath?: () => string
  getEnvPath?: () => string
}

export type TypeDBConstants = {
  isDev: boolean
  dbPath: string
  dbUrl: string
}

// v8: getPrisma is async and returns { Account, Thread, ThreadMessage, client, runtime, db }
export type TypeGetPrisma = (ctx: IContextDB) => Promise<{
  Account: any
  Thread: any
  ThreadMessage: any
  client: any
  runtime: any
  db: any
}>

export type TypeGetDBConstants = (ctx: IContextDB) => TypeDBConstants

// v8: model names are literal union, not Prisma.ModelName
export type TypeDBModels = {
  getAccountModel: DBModelsGetterMap['Account']
  getThreadModel: DBModelsGetterMap['Thread']
  getThreadMessageModel: DBModelsGetterMap['ThreadMessage']
}

export type RunPrismaCmdParam = {
  ctx: IContextDB
}
export type TypeRunPrismaCommand = (param: RunPrismaCmdParam) => Promise<number>

export type TypeGetAnalyticsPrisma = (ctx: IContextDB) => Promise<{
  AnalyticsEvent: any
  AnalyticsMeta: any
  client: any
  runtime: any
  db: any
}>

export type RunAnalyticsPrismaCmdParam = {
  ctx: IContextDB
}
export type TypeRunAnalyticsPrismaCommand = (param: RunAnalyticsPrismaCmdParam) => Promise<number>

export interface IFacade {
  getPrisma: TypeGetPrisma
  getDBConstants: TypeGetDBConstants
  DBModels: TypeDBModels
  DB_FILE_NAME: string
  runPrismaCommand: TypeRunPrismaCommand
  getAnalyticsPrisma: TypeGetAnalyticsPrisma
  runAnalyticsPrismaCommand: TypeRunAnalyticsPrismaCommand
  ANALYTICS_DB_FILE_NAME: string
}
