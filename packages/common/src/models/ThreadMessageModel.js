/**
 * @type {import('./ThreadMessageModel.d.ts').GetThreadMessageModel}
 */
export const getThreadMessageModel = (client, db) => ({
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
      const msg = await client.ThreadMessage.create({
        id: crypto.randomUUID(),
        accountId,
        threadId,
        prompt,
        promptId,
        chatProvider: chatProvider || '',
        chatModel: chatModel || '',
        response: JSON.stringify(response),
        createTime: new Date(),
        updateTime: new Date(),
      });
      return { msg, error: null };
    } catch (error) {
      console.error('[ThreadMessage] create failed:', error.message);
      return { msg: null, error: error.message };
    }
  },

  get: async function (clause = {}, limit = null, orderBy = null) {
    try {
      let query = client.ThreadMessage.where(clause);

      if (orderBy !== null) {
        query = query.orderBy(convertOrderBy(orderBy));
      }

      if (limit !== null) {
        query = query.limit(limit);
      }

      const msg = await query.first();
      return msg || null;
    } catch (error) {
      console.error('[ThreadMessage] get failed:', error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await client.ThreadMessage.where(clause).deleteAll();
      return true;
    } catch (error) {
      console.error('[ThreadMessage] delete failed:', error.message);
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
      let query = client.ThreadMessage.where(clause);

      if (orderBy !== null) {
        query = query.orderBy(convertOrderBy(orderBy));
      }

      if (limit !== null) {
        query = query.limit(limit);
      }

      if (offset !== null) {
        query = query.offset(offset);
      }

      const msgs = await query.all();
      return msgs;
    } catch (error) {
      console.error('[ThreadMessage] where failed:', error.message);
      return [];
    }
  },

  count: async function (clause = {}) {
    try {
      const result = await client.ThreadMessage
        .where(clause)
        .aggregate((agg) => ({ n: agg.count() }));
      return Number(result.n);
    } catch (error) {
      console.error('[ThreadMessage] count failed:', error.message);
      return 0;
    }
  },

  bulkCreate: async function (msgsData) {
    try {
      const msgsWithDefaults = msgsData.map(d => ({
        id: crypto.randomUUID(),
        accountId: d.accountId,
        threadId: d.threadId,
        prompt: d.prompt,
        promptId: d.promptId,
        chatProvider: d.chatProvider || '',
        chatModel: d.chatModel || '',
        response: typeof d.response === 'string' ? d.response : JSON.stringify(d.response),
        createTime: new Date(),
        updateTime: new Date(),
      }));

      const createdChats = await client.ThreadMessage.createAll(msgsWithDefaults);
      return { msgs: createdChats, error: null };
    } catch (error) {
      console.error('[ThreadMessage] bulkCreate failed:', error.message);
      return { msgs: null, error: error.message };
    }
  },
});

/**
 * Convert v7-style orderBy object to v8-style orderBy callback
 * @param {Object|Array} orderBy - v7 orderBy format
 * @returns {Function|Array} v8 orderBy format
 */
function convertOrderBy(orderBy) {
  // Handle array of orderBy objects
  if (Array.isArray(orderBy)) {
    return orderBy.map(item => {
      const [key, direction] = Object.entries(item)[0];
      return (m) => m[key][direction]();
    });
  }

  // Handle single orderBy object
  const [key, direction] = Object.entries(orderBy)[0];
  return (m) => m[key][direction]();
}

export default { getThreadMessageModel };
