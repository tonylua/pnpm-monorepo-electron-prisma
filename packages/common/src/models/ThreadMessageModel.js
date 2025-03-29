/**
 * @type {import('./ThreadMessageModel.d.ts').GetThreadMessageModel}
 */
const getThreadMessageModel = prisma => ({
  modelName: "ThreadMessage",

  create: async function ({
    accountId,
    threadId = null,
    prompt,
    promptId,
    chatProvider,
    chatModel,
    response = {},
  }) {
    try {
      const msg = await prisma.ThreadMessage.create({
        data: {
          accountId,
          threadId,
          prompt,
          promptId,
          chatProvider,
          chatModel,
          response: JSON.stringify(response),
        },
      });
      return { msg, error: null };
    } catch (error) {
      console.error(error.message);
      return { msg: null, error: error.message };
    }
  },

  get: async function (clause = {}, limit = null, orderBy = null) {
    try {
      const msg = await prisma.ThreadMessage.findFirst({
        where: {
          ...clause,
        },
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
      return msg || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.ThreadMessage.deleteMany({
        where: clause,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    offset = null
  ) {
    try {
      const msgs = await prisma.ThreadMessage.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(offset !== null ? { skip: offset } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
      return msgs;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  count: async function (clause = {}) {
    try {
      const count = await prisma.ThreadMessage.count({
        where: clause,
      });
      return count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  bulkCreate: async function (msgsData) {
    try {
      const createdChats = [];
      for (const chatData of msgsData) {
        const msg = await prisma.ThreadMessage.create({
          data: chatData,
        });
        createdChats.push(msg);
      }
      return { msgs: createdChats, error: null };
    } catch (error) {
      console.error(error.message);
      return { msgs: null, error: error.message };
    }
  },
});

module.exports = { getThreadMessageModel };
