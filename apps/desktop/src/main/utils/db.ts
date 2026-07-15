import fs from 'node:fs'
import type { PrismaClient } from '@app/common'
import type { IFacade, PrismaMigration } from '@app/common'
import * as commonFacade from '@app/common'
import { dbContext } from './dbContext'

const { getPrisma, getDBConstants, DBModels, runPrismaCommand } =
  commonFacade as unknown as IFacade
const { getAccountModel, getThreadModel, getThreadMessageModel } = DBModels
const { dbPath, latestMigration } = getDBConstants(dbContext)

export const isDev = process.env.NODE_ENV === 'development'

process.env.DATABASE_URL = `file:${dbPath}`
const prisma: PrismaClient = getPrisma(dbContext)

const modelsFactory = {
  Account: getAccountModel,
  Thread: getThreadModel,
  ThreadMessage: getThreadMessageModel
}

// Prisma 7 is Rust-free: migrations are applied by executing the generated
// migration.sql files directly through node:sqlite (see @app/common
// runPrismaCommand), not by forking the Prisma CLI.
const runPrisma = () => runPrismaCommand({ ctx: dbContext })


export async function handlePersistenceAction(
  _,
  model: string,
  action: string,
  ...args: unknown[]
) {
  try {
    const modelInstanceGetter = modelsFactory[model]
    if (!modelInstanceGetter) throw new Error(`factory function for ${model} not found`)
    const m = modelInstanceGetter(prisma)
    if (!m) throw new Error(`model ${model} not found`)
    return m[action](...args)
  } catch (error) {
    console.error(error)
  }
  return null
}

export async function initDB() {
  let needsMigration = false
  const dbExists = fs.existsSync(dbPath)
  if (!dbExists) {
    needsMigration = true
    fs.closeSync(fs.openSync(dbPath, 'w'))
  } else {
    try {
      const latest: PrismaMigration[] =
        await prisma.$queryRaw`select * from _prisma_migrations order by finished_at`
      const mname = latest[latest.length - 1]?.migration_name
      needsMigration = !mname?.endsWith(latestMigration)
      console.log(`db latest migration: ${mname}, want migration suffix: ${latestMigration}`)
    } catch (e) {
      // @ts-ignore debug
      console.error('[db.ts SELECT *]', e, prisma?._engine?.datasourceOverrides)
      needsMigration = true
    }
  }
  if (!needsMigration) {
    console.log('%c Does not need migration', 'color: green')
    return
  }

  // Release the SQLite connection so the migration runner has exclusive write access.
  await prisma.$disconnect()

  try {
    console.log('%c Needs a migration. Applying migration.sql files directly.', 'color: red')
    await runPrisma()
    console.log('√ Migration done.')
  } catch (e) {
    console.error('× Migration failed.', e)
    throw e
  } finally {
    await prisma.$connect()
  }
}
