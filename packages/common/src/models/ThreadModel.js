import { withGeneratedId } from '../utils/idUtils.js'
import { buildOrderBy } from './queryUtils.js'

/**
 * @type {import('./ThreadModel.d.ts').GetThreadModel}
 */
const getThreadModel = (client, db) => ({
  modelName: "Thread",

  defaultName: "Thread",

  create: async function (account, data = {}) {
    try {
      const now = new Date();
      const thread = await client.Thread.create(
        withGeneratedId({
          name: data.name ? String(data.name) : this.defaultName,
          accountId: account.id,
          vectorSearchMode: 'default',
          createTime: now,
          updateTime: now,
        })
      );

      return { thread, error: null };
    } catch (error) {
      console.error('[Thread] create failed:', error.message);
      return { thread: null, error: error.message };
    }
  },

  update: async function (prevThread = null, data = {}) {
    if (!prevThread) throw new Error("No thread id provided for update");

    try {
      const thread = await client.Thread.where({ id: prevThread.id }).update({
        ...data,
        updateTime: new Date(),
      });
      return { thread, error: null };
    } catch (error) {
      console.error('[Thread] update failed:', error.message);
      return { thread: null, error: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      const thread = await client.Thread.where(clause).first();

      return thread || null;
    } catch (error) {
      console.error('[Thread] get failed:', error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await client.Thread.where(clause).deleteAll();
      return true;
    } catch (error) {
      console.error('[Thread] delete failed:', error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      let query = client.Thread.where(clause);

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
      console.error('[Thread] where failed:', error.message);
      return [];
    }
  },

  // Will fire on first message (included or not) for a thread and rename the thread with the newName prop.
  autoRenameThread: async function ({
    account = null,
    thread = null,
    newName = null,
    onRename = null,
  }) {
    if (!account || !thread || !newName) return false;
    if (thread.name !== this.defaultName) return false; // don't rename if already named.

    const { getThreadMessageModel } = await import("./ThreadMessageModel.js");
    const msgCount = await getThreadMessageModel(client, db).count({
      accountId: account.id,
      threadId: thread.id,
    });

    if (msgCount !== 1) return { renamed: false, thread };

    const { thread: updatedThread } = await this.update(thread, {
      name: newName,
    });

    onRename?.(updatedThread);
    return true;
  },
});

export { getThreadModel };
