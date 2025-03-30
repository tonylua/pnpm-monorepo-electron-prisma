import fs from 'node:fs'
import sharedFacade, { type IFacade, type PrismaMigration } from '@app/common'
import { dbContext } from './dbContext'

const { getPrisma, getDBConstants, DBModels, runPrismaCommand } =
  sharedFacade as unknown as IFacade
const { getAccountModel, getThreadModel, getThreadMessageModel } = DBModels
const prisma = getPrisma(dbContext)
const { dbPath, dbUrl, latestMigration } = getDBConstants(dbContext)

const modelsFactory = {
  Account: getAccountModel,
  Thread: getThreadModel,
  ThreadMessage: getThreadMessageModel
}

export async function handlePersistenceAction(
  model: string,
  action: string,
  ...args: any[]
) {
  try {
    // console.log('edge::handlePersistenceAction', model, action, ...args)
    // @ts-ignore
    const modelInstanceGetter = modelsFactory[model]
    if (!modelInstanceGetter) throw new Error(`factory function for ${model} not found`)
    const m = modelInstanceGetter(prisma)
    // console.log('==main/utils/db.ts::handlePersistenceAction==', !!prisma, m.modelName)
    if (!m) throw new Error(`model ${model} not found`)
    return m[action](...args)
  } catch (error) {
    console.error(error)
  }
  return null
}

// 每次应用启动时运行 Prisma 的 migrate deploy 命令
// 确保用户 sqlite 数据库在应用更新且数据库模式更改时能自动迁移
export async function initDB() {
  let needsMigration = false
  const dbExists = fs.existsSync(dbPath)
  if (!dbExists) {
    needsMigration = true
    // 确保数据库文件存在
    fs.closeSync(fs.openSync(dbPath, 'w'))
  }

  process.env.DATABASE_URL = dbUrl
  console.log('🌍 edge DB env::DATABASE_URL', process.env.DATABASE_URL)
  try {
    const latest: PrismaMigration[] =
      await prisma.$queryRaw`select * from _prisma_migrations order by finished_at`
    const mname = latest[latest.length - 1]?.migration_name
    needsMigration = !mname.endsWith(latestMigration)
    console.log(`db latest migration: ${mname}, want migration suffix: ${latestMigration}`)
  } catch (e) {
    console.error('db.ts', e)
    needsMigration = true
  }

  const schemaPath = dbContext.getSchemaPrismaPath!()
  const prismaPath = dbContext.getPrismaPath?.()
  if (needsMigration) {
    try {
      console.log(`Needs a migration. Running prisma migrate with schema path ${schemaPath}`)

      await runPrismaCommand({
        ctx: dbContext,
        command: ['migrate', 'deploy', '--schema', schemaPath],
        prismaPath
      })

      console.log('Migration done.')
    } catch (e) {
      console.error('Migration failed.', e)

      try {
        await runPrismaCommand({
          ctx: dbContext,
          command: ['migrate', 'reset', '--force', '--schema', schemaPath],
          prismaPath
        })
        await runPrismaCommand({
          ctx: dbContext,
          command: ['migrate', 'deploy', '--schema', schemaPath],
          prismaPath
        })

        console.log('Migration reset.')
      } catch (e) {
        process.exit(1)
      }
    }
  } else {
    console.log(`Does not need migration -- ${schemaPath}`)
  }
}
