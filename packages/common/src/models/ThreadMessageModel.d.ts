import { Models } from '../generated/db_client/contract'

type ThreadMessage = Models.ThreadMessage

type CreateParams<T = any> = Partial<ThreadMessage> & {
  response: T
}

// v8: model factories take (client, db) instead of (prisma)
export type GetThreadMessageModel = (client: any, db: any) => {
  modelName: string
  defaultName?: string
  create<T = any>(param: CreateParams<T>): Promise<{ msg: ThreadMessage | null; error: string | null }>
  bulkCreate<T = any>(
    params: CreateParams<T>[]
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
    offset?: number
  ): Promise<ThreadMessage[]>
  count(clause: Partial<ThreadMessage>): Promise<number>
}
