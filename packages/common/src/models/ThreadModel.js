/**
 * @type {import('./ThreadModel.d.ts').GetThreadModel}
 */
const getThreadModel = prisma => ({
  modelName: "Thread",

  defaultName: "Thread",

  create: async function (account, data = {}) {
    try {
      const thread = await prisma.Thread.create({
        data: {
          name: data.name ? String(data.name) : this.defaultName,
          accountId: account.id,
        },
      });

      return { thread, error: null };
    } catch (error) {
      console.error(error.message);
      return { thread: null, error: error.message };
    }
  },

  update: async function (prevThread = null, data = {}) {
    if (!prevThread) throw new Error("No thread id provided for update");

    try {
      const thread = await prisma.Thread.update({
        where: { id: prevThread.id },
        data,
      });
      return { thread, error: null };
    } catch (error) {
      console.error(error.message);
      return { thread: null, error: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      const thread = await prisma.Thread.findFirst({
        where: {
          ...clause
        },
      });

      return thread || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.Thread.deleteMany({
        where: clause,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      const results = await prisma.Thread.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
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

    const { getThreadMessageModel } = require("./ThreadMessageModel");
    const msgCount = await getThreadMessageModel(prisma).count({
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

module.exports = { getThreadModel };