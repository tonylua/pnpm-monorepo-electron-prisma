import { datetimeColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, field, model, rel } from '@prisma/orm-sqlite/contract-builder';

const Account = model('Account', {
  fields: {
    id: field.column(textColumn).id(),
    username: field.column(textColumn),
    email: field.column(textColumn).optional(),
    globalSetting: field.column(textColumn).optional(),
  },
});

const Thread = model('Thread', {
  fields: {
    id: field.column(textColumn).id(),
    name: field.column(textColumn),
    accountId: field.column(textColumn),
    setting: field.column(textColumn).optional(),
    chatProvider: field.column(textColumn).optional(),
    chatModel: field.column(textColumn).optional(),
    vectorTag: field.column(textColumn).optional(),
    vectorSearchMode: field.column(textColumn).default('default'),
    updateTime: field.column(datetimeColumn),
    createTime: field.column(datetimeColumn),
  },
});

const ThreadMessage = model('ThreadMessage', {
  fields: {
    id: field.column(textColumn).id(),
    accountId: field.column(textColumn),
    threadId: field.column(textColumn),
    chatProvider: field.column(textColumn).default(''),
    chatModel: field.column(textColumn).default(''),
    prompt: field.column(textColumn),
    promptId: field.column(textColumn),
    response: field.column(textColumn),
    updateTime: field.column(datetimeColumn),
    createTime: field.column(datetimeColumn),
  },
});

export const contract = defineContract({
  models: {
    Account: Account.relations({
      threads: rel.hasMany(Thread, { by: 'accountId' }),
      threadMessages: rel.hasMany(ThreadMessage, { by: 'accountId' }),
    }),
    Thread: Thread.relations({
      account: rel.belongsTo(Account, { from: 'accountId', to: 'id' }),
    }),
    ThreadMessage: ThreadMessage.relations({
      account: rel.belongsTo(Account, { from: 'accountId', to: 'id' }),
    }),
  },
});
