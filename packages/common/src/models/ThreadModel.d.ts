import { Account, PrismaClient, Thread } from '@prisma/client'

export type GetThreadModel = <T = unknown>(
  prisma: PrismaClient
) => {
  modelName: string
  defaultName?: string
  create(
    account: Account,
    data: Partial<Thread>
  ): Promise<{ thread: Thread | null; error: string | null }>
  update(
    prevThread: Thread,
    data: Partial<Thread>
  ): Promise<{ thread: Thread | null; error: string | null }>
  get(clause: Partial<Thread>): Promise<Thread | null>
  delete(clause: Partial<Thread>): Promise<boolean>
  where(
    clause: Partial<Thread>,
    limit: number | null,
    orderBy: Partial<Record<keyof Thread, 'asc' | 'desc'>>[] | null
  ): Promise<Thread[]>
  autoRenameThread(params: {
    account: Account
    thread: Thread
    newName: string
    onRename?: (updatedThread: Thread) => void
  }): Promise<boolean>
}
