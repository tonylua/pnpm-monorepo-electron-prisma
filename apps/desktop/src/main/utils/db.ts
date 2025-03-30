import fs from 'node:fs'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import type { IFacade, PrismaMigration } from '@app/common'
import * as commonFacade from '@app/common'
import { dbContext } from './dbContext'

const { getPrisma, getDBConstants, DBModels, runPrismaCommand } =
  commonFacade as unknown as IFacade
const { getAccountModel, getThreadModel, getThreadMessageModel } = DBModels
const { dbPath, latestMigration } = getDBConstants(dbContext)

export const isDev = process.env.NODE_ENV === 'development'
const schemaPath = isDev
  ? dbContext.getSchemaPrismaPath!()
  // @ts-ignore
  : path.join(process.resourcesPath, 'prisma', 'schema.prisma')
const prismaPath = dbContext.getPrismaPath?.()

process.env.DATABASE_URL = `file:${dbPath}`
const prisma: PrismaClient = getPrisma(dbContext)

const modelsFactory = {
  Account: getAccountModel,
  Thread: getThreadModel,
  ThreadMessage: getThreadMessageModel
}

const runPrisma = (...args: string[]) =>
  runPrismaCommand({
    ctx: dbContext,
    command: [...args, '--schema', schemaPath],
    prismaPath
  })


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
  }

  try {
    const latest: PrismaMigration[] =
      await prisma.$queryRaw`select * from _prisma_migrations order by finished_at`
    const mname = latest[latest.length - 1]?.migration_name
    needsMigration = !mname.endsWith(latestMigration)
    console.log(`db latest migration: ${mname}, want migration suffix: ${latestMigration}`)
  } catch (e) {
    // @ts-ignore debug
    console.error('[db.ts SELECT *]', e, prisma?._engine?.datasourceOverrides)
    needsMigration = true
  }
  if (!needsMigration) {
    console.log(`%c Does not need migration -- ${schemaPath}`, 'color: green')
    return
  }

  try {
    console.log(
      `%c Needs a migration. Running prisma migrate with schema path ${schemaPath}`,
      'color: red'
    )
    await runPrisma('migrate', 'deploy')
    console.log('√ Migration done.')
  } catch (e) {
    console.error('× Migration failed.', e)
    try {
      await runPrisma('migrate', 'reset', '--force')
      await runPrisma('migrate', 'deploy')
      console.log('Migration reset.')
    } catch (ex) {
      await runPrisma('migrate', 'deploy')
      console.error('🐝 Migration again and anain', ex)
    }
  }
}
