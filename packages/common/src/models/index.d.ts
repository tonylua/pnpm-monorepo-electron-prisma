import { GetAccountModel } from './AccountModel'
import { GetThreadModel } from './ThreadModel'
import { GetThreadMessageModel } from './ThreadMessageModel'

export type DBModelsGetterMap = {
  Account: GetAccountModel
  Thread: GetThreadModel
  ThreadMessage: GetThreadMessageModel
}
