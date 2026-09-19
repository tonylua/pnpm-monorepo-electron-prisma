import { join, resolve } from 'path'
import sqlite from '@prisma/orm-sqlite/runtime'
import { orm } from '@prisma/orm-sqlite/orm-client'
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir'
import { config as dotenvConfig } from 'dotenv'
import getDBConstants from './dbConstants.js'
import { createModels } from '../../models/index.js'
import contractJson from '../../generated/db_client/contract.json' with { type: 'json' }

// NOTE: this source is bundled into a single CJS file (dist/index.js) by esbuild.
// __dirname resolves to the dist bundle dir at runtime (where build.mjs copies
// .env/.env.dev), matching the v7 behavior. Do not use import.meta.url — it is
// empty in CJS output.

// Static runtime factory (v8 pattern: db is the factory, not the connection)
export const db = sqlite({ contractJson })

/**
 * Creates ORM client from runtime
 * @param {import('@prisma/orm-sqlite/runtime').SqliteRuntime} runtime
 * @returns {any} ORM client with PascalCase model accessors
 */
function createOrmClient(runtime) {
  const context = db.context
  return orm({ runtime, context })[UNBOUND_NAMESPACE_ID]
}

/**
 * Initialize and return Prisma v8 runtime + models
 * Returns v8 object with wired model instances ready to use.
 *
 * For v7 compatibility callers can still do:
 *   const { Account, Thread, ThreadMessage } = getPrisma(ctx)
 *   await Account.create(...)
 *
 * v8 internals also exposed for advanced uses:
 *   const { client, runtime, db } = getPrisma(ctx)
 *
 * @param {Object} ctx - Context object with optional getEnvPath() method
 * @returns {Promise<{Account: any, Thread: any, ThreadMessage: any, client: any, runtime: any, db: any}>}
 */
export async function getPrisma(ctx) {
  if (global.prismaRuntime) {
    return global.prismaRuntime
  }

  let isDev = process.env.NODE_ENV === 'development'
  if (!process.env.IS_WEB) isDev ||= global?.isElectronDev

  let envPath

  if (typeof ctx.getEnvPath === 'function') {
    envPath = ctx.getEnvPath()
  } else if (isDev) {
    envPath = resolve(__dirname, '.env.dev')
  } else {
    envPath = join(process.resourcesPath, 'prisma/.env')
  }
  dotenvConfig({ path: envPath })

  const constants = getDBConstants(ctx)
  // v8 uses file path; v7 used file: URL. Support both during migration.
  const dbPath = constants.dbPath || constants.dbUrl?.replace('file:', '')

  console.log(
    ['%c ￥@app/common::getPrisma￥', envPath, dbPath].join('\n'),
    'color: yellow'
  )

  // Prisma 8 runtime: connect to SQLite database.
  // The db factory was created at module load; now we connect to the actual file.
  // Like v7, v8 uses @prisma/orm-sqlite with Node 24+ built-in node:sqlite,
  // shipping zero native SQLite dependencies. See memory/prisma7-integration-facts.md.
  const runtime = await db.connect({ path: dbPath })

  // Create ORM client for query builder API
  const client = createOrmClient(runtime)

  // Wire up model instances (v7-style interface)
  const models = createModels(client, db)

  const result = { ...models, client, runtime, db }
  global.prismaRuntime = result

  return result
}

export default getPrisma
