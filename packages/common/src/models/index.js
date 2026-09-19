import { getAccountModel } from './AccountModel.js'
import { getThreadModel } from './ThreadModel.js'
import { getThreadMessageModel } from './ThreadMessageModel.js'

/**
 * Factory that wires model factories with client and db runtime.
 * v8 models need both: client for queries, db for transactions.
 *
 * @param {any} client - ORM client from orm({runtime, context})[UNBOUND_NAMESPACE_ID]
 * @param {any} db - sqlite runtime factory for transactions
 * @returns {{Account: any, Thread: any, ThreadMessage: any}}
 */
export function createModels(client, db) {
  return {
    Account: getAccountModel(client, db),
    Thread: getThreadModel(client, db),
    ThreadMessage: getThreadMessageModel(client, db),
  }
}

// Legacy v7-style exports for backward compat during migration
export const DBModels = {
  getAccountModel,
  getThreadModel,
  getThreadMessageModel,
}

export default DBModels