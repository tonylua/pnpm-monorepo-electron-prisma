import { Account, PrismaClient, Thread, ThreadMessage } from '@prisma/client'

type CreateParams = Partial<ThreadMessage> & {
  response: T
}

export type GetThreadMessageModel = (prisma: PrismaClient) => {
  modelName: string
  defaultName?: string
  create(param: CreateParams): Promise<{ msg: ThreadMessage | null; error: string | null }>
  bulkCreate(
    params: CreateParams[]
  ): Promise<{ msgs: ThreadMessage[] | null; error: string | null }>
  get(
    clause: Partial<ThreadMessage>,
    limit: number | null,
    orderBy: Partial<Record<keyof ThreadMessage, 'asc' | 'desc'>> | null
  ): Promise<ThreadMessage | null>
  delete(clause: Partial<ThreadMessage>): Promise<boolean>
  where(
    clause: Partial<ThreadMessage>,
    limit: number | null,
    orderBy: Partial<Record<keyof ThreadMessage, 'asc' | 'desc'>>[] | null,
    offset?: keyof ThreadMessage
  ): Promise<ThreadMessage[]>
  count(clause: Partial<ThreadMessage>): Promise<number>
}
