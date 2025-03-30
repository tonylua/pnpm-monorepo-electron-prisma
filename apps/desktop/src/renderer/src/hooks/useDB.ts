import { getDBModelProxy, omit } from '@renderer/utils'
import type { Account, Thread } from '@prisma/client'

function getNewThreadName() {
  const now = new Date()
  const formattedTime = `${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return `Thread${formattedTime}`
}

function useDB() {
  const AccountModel = getDBModelProxy<'Account'>('Account')
  const ThreadModel = getDBModelProxy<'Thread'>('Thread')
  const ThreadMessageModel = getDBModelProxy<'ThreadMessage'>('ThreadMessage')

  // 取得账号
  const getAccount = async (username: string) => {
    let account = await AccountModel.get({ username })
    if (!account) account = (await AccountModel.create(username)).account
    return account
  }

  // 创建新对话
  const createNewThread = async (account: Account, name = getNewThreadName()) => {
    const data = {
      chatProvider: 'foo',
      chatModel: 'bar',
      name: ''
    }
    if (name) data.name = name
    const { thread, error } = await ThreadModel.create(
      // 避免ipc直接传递proxy对象报错
      { ...account },
      data
    )
    if (error) throw new Error(error)
    if (!thread) return thread

    // 更新到用户表
    const threadWithoutForeignKey = omit(thread, ['accountId'])
    await AccountModel.updateArrayProp(account.id, 'threads', [threadWithoutForeignKey])

    return thread
  }

  // 创建默认对话
  const createDefaultThread = async (account: Account) => {
    const currentThreadName = getNewThreadName()

    let thread: Thread | null = await ThreadModel.get({ name: currentThreadName })
    if (!thread) thread = await createNewThread(account, currentThreadName)

    return thread
  }

  // 列出所有对话
  const listThreads = async (account: Account) => {
    const threads: Thread[] = await ThreadModel.where({ accountId: account.id }, null, [
      {
        updateTime: 'desc'
      }
    ])
    return threads
  }

  // 列出对话中的历史信息
  const listThreadMessages = async (
    accountId: string,
    threadId: string,
    limit: number | null = null
  ) => {
    const messages = await ThreadMessageModel.where(
      {
        accountId,
        threadId
      },
      limit,
      [
        {
          updateTime: 'desc'
        }
      ]
    )
    return messages
  }

  // 保存对话中完成的信息
  const saveThreadMessage = async ({
    accountId,
    threadId,
    prompt,
    promptId,
    response,
    chatModel,
    chatProvider
  }: any) => {
    const where = { id: threadId, accountId }
    const thread = await ThreadModel.get(where)
    if (!thread) throw new Error('no thread')
    // 插入一次对话记录
    const { msg, error } = await ThreadMessageModel.create({
      accountId: 'foo',
      threadId: thread.id,
      prompt: prompt || '',
      promptId,
      response,
      chatModel,
      chatProvider
    })
    if (error) return error
    // 更新用户的对话记录
    const account = await AccountModel.get({ id: accountId })
    if (!account) throw new Error('get account fail')
    const msgWithoutForeignKey = omit(msg, ['accountId'])
    await AccountModel.updateArrayProp(account.id, 'threadMessages', [msgWithoutForeignKey])
    return null
  }

  return {
    getAccount,
    listThreads,
    listThreadMessages,
    saveThreadMessage,
    createNewThread,
    createDefaultThread
  }
}

export default useDB
