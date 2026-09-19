import { Models } from '../generated/db_client/contract'

type Account = Models.Account

// v8: model factories take (client, db) instead of (prisma)
export type GetAccountModel = (
  client: any,
  db: any
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
    arr: any[]
  ): Promise<{ account: Account | null; error: string | null }>
  get(clause: Partial<Account>): Promise<Account | null>
  delete(clause: Partial<Account>): Promise<boolean>
  where(
    clause: Partial<Account>,
    limit: number | null,
    orderBy: Partial<Record<keyof Account, 'asc' | 'desc'>>[] | null
  ): Promise<Account[]>
}
