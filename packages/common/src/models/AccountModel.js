/**
 * Merge arrays by id, keeping the latest version of each item
 * @param {Array} existing - existing array
 * @param {Array} incoming - incoming array to merge
 * @returns {Array} merged array with unique items by id
 */
function mergeArraysById(existing, incoming) {
  return [
    ...new Map([...existing, ...incoming].map((item) => [item.id, item])).values(),
  ];
}

import { withGeneratedId } from '../utils/idUtils.js'
import { buildOrderBy } from './queryUtils.js'

/**
 * @type {import('./AccountModel.d.ts').GetAccountModel}
 */
export const getAccountModel = (client, db) => ({
  modelName: "Account",

  create: async function (username = null) {
    if (!username) return { account: null, error: "username cannot be null" };

    try {
      // v8: no @default directives in contract, application supplies id
      const account = await client.Account.create(
        withGeneratedId({
          username,
        })
      );

      return { account, error: null };
    } catch (error) {
      console.error('[Account] create failed:', error.message);
      return { account: null, error: error.message };
    }
  },

  update: async function (id = null, data = {}) {
    if (!id) throw new Error("No account id provided for update");
    try {
      // v8: requires prior .where(), returns Row | null
      const account = await client.Account.where({ id }).update(data);
      return { account, error: null };
    } catch (error) {
      console.error('[Account] update failed:', error.message);
      return { account: null, error: error.message };
    }
  },

  updateArrayProp: async function (id, propName, arr) {
    // In v7, 'threads' and 'threadMessages' were Prisma relation fields updated
    // via nested writes. In v8 those are virtual relations — the data already
    // lives in Thread/ThreadMessage rows linked by accountId. No denormalization
    // is needed; skip silently so the renderer call is a no-op.
    const RELATION_FIELDS = ['threads', 'threadMessages'];
    if (RELATION_FIELDS.includes(propName)) {
      return { account: null, error: null };
    }

    // For actual JSON scalar columns on Account (e.g. globalSetting),
    // do an atomic read-modify-write inside a transaction.
    try {
      const account = await db.transaction(async (tx) => {
        const current = await tx.orm.Account.where({ id }).first();
        if (!current) throw new Error(`account ${id} not found`);

        const parsed = JSON.parse(current[propName] || '[]');
        const merged = mergeArraysById(parsed, arr);

        return tx.orm.Account.where({ id }).update({
          [propName]: JSON.stringify(merged),
        });
      });
      return { account, error: null };
    } catch (error) {
      console.error('[Account] updateArrayProp failed:', error.message);
      return { account: null, error: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      // v8: .where(clause).first() returns Row | null
      const account = await client.Account.where(clause).first();
      return account || null;
    } catch (error) {
      console.error('[Account] get failed:', error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      // v8: requires prior .where(), .delete() deletes first match
      await client.Account.where(clause).delete();
      return true;
    } catch (error) {
      console.error('[Account] delete failed:', error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      // v8: .where(clause).orderBy(...).limit(...).all()
      let query = client.Account.where(clause);

      const orderByCallbacks = buildOrderBy(orderBy);
      if (orderByCallbacks) {
        query = query.orderBy(orderByCallbacks);
      }

      if (limit !== null) {
        query = query.limit(limit);
      }

      const results = await query.all();
      return results;
    } catch (error) {
      console.error('[Account] where failed:', error.message);
      return [];
    }
  },
});

export default { getAccountModel };
