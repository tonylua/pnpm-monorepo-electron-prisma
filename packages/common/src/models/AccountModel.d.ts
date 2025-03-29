import { Account, PrismaClient, Thread } from '@prisma/client'

export type GetAccountModel = <T = unknown>(
  prisma: PrismaClient
) => {
  modelName: string
  defaultName?: string
  create(username: string | null): Promise<{ account: Account | null; error: string | null }>
  update(
    id: string,
    data: Partial<Account>
  ): Promise<{ account: Account | null; error: string | null }>
  updateArrayProp(
    id: string,
    propName: string,
    arr: Partial<Account>[]
  ): Promise<{ account: Account | null; error: string | null }>
  get(clause: Partial<Account>): Promise<Account | null>
  delete(clause: Partial<Account>): Promise<boolean>
  where(
    clause: Partial<Account>,
    limit: number | null,
    orderBy: Partial<Record<keyof Thread, 'asc' | 'desc'>>[] | null
  ): Promise<Account[]>
}
