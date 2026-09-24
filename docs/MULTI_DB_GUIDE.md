# Prisma v8 多数据库扩展方法论

**目标读者**: AI agent（也适合人类开发者参考）  
**使用场景**: 在现有单库 Electron + Prisma v8 项目中添加第 N 个独立 SQLite 数据库  
**前置要求**: 项目已有一个工作的 Prisma v8 数据库（称为"主库"）

---

## 为什么需要多数据库（而不是多表）

SQLite 的**写锁是文件级别**的：
- 同一个 `.db` 文件同一时刻只能有一个写事务
- 大量写入会阻塞其他事务，即使操作的是不同表

适合拆分数据库的场景：
1. **高频写入数据**（日志、埋点）独立出去，不阻塞主业务
2. **多团队开发**：不同团队负责的功能域拆成独立库，schema 变更不互相影响
3. **生命周期差异**：临时缓存可以随时删除/重建，不影响用户数据
4. **读写比例悬殊**：只读的参考数据（字典表）可以单独一个库

**不适合拆分的情况**：
- 需要跨表 JOIN 或事务保证原子性的数据（SQLite 不支持跨文件事务）
- 低频操作且无并发冲突的数据（拆分增加复杂度但无收益）

---

## AI 执行协议

当用户请求"添加第 2 个数据库用于 XXX"时：

### 1. 确认需求
- **数据库名称**（如 `logs`、`cache`、`analytics`），记为 `<DB_NAME>`
- **用途简述**（帮助生成合理的 schema）
- **模型清单**（如 `LogEntry`、`LogMeta`），记为 `<Model1>`、`<Model2>` ...

### 2. 创建工作分支
```bash
BRANCH_NAME="feature/multi-db-<DB_NAME>-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH_NAME"
```

### 3. 按本文档的"扩展清单"依次执行
每一步都会说明：
- **为什么需要这个文件/修改**（架构职责）
- **在哪里改**（文件路径 + 定位提示）
- **改什么**（通用模式，用占位符表示）

### 4. 验证 & 报告
执行"验证清单"中的命令，将分支名和验证结果报告给用户。

---

## 架构概览

Prisma v8 的多数据库架构是**纯代码复制**（没有全局配置统一管理多库）：

```
主库                              第 N 个库 (<DB_NAME>)
├─ contract.ts                    ├─ <db_name>/contract.ts
├─ prisma.config.ts               ├─ prisma.<db_name>.config.ts
├─ migrations/                    ├─ <db_name>/migrations/
├─ generated/db_client/           ├─ generated/<db_name>_db_client/
├─ utils/prisma/                  ├─ utils/prisma/
│  ├─ index.js (runtime)          │  ├─ <db_name>Runtime.js
│  └─ runPrismaCommand.js         │  └─ <db_name>RunPrismaCommand.js
└─ models/ (业务 wrapper)         └─ models/ (<Model1>Model.js, ...)

集成点（需修改现有文件）:
├─ facade.js              // 导出新库的 get<DbName>Prisma 和常量
├─ types.d.ts             // 声明新库的类型和接口扩展
├─ dbContext.ts           // 提供新库的路径获取方法
├─ main/index.ts          // 初始化新库 + 注册 IPC handler
├─ preload/index.ts       // 暴露新库 API 给渲染进程
├─ build.mjs              // 拷贝新库的 migrations 和 generated
└─ package.json           // 添加新库的 npm 脚本
```

**关键原则**：
- 每个库有独立的 contract、config、migrations、generated client
- 每个库有独立的 runtime factory（负责连接和 ORM 实例化）
- 集成点（facade/types/dbContext）需要显式添加每个新库

---

## 扩展清单

### Step 1: 创建 Contract（Schema 定义）

**职责**: 定义新库的表结构和字段类型

**文件**: `packages/common/src/prisma/<db_name>/contract.ts`

**操作**:
1. 参考主库的 `contract.ts`，理解项目使用的 field types（textColumn、datetimeColumn 等）
2. 根据用户需求设计模型（如 `LogEntry`、`CacheItem`）
3. 使用 `defineContract({ models: { ... } })` 导出

**关键点**:
- `id` 字段建议用 `.default('uuid()')` 或 `.default('cuid()')`
- 时间戳字段用 `datetimeColumn`
- 可选字段用 `.optional()`
- 注释清楚这是哪个库的 contract

---

### Step 2: 创建 CLI Config

**职责**: 告诉 Prisma CLI 这个库的 contract 在哪、输出到哪、migrations 放哪

**文件**: `packages/common/prisma.<db_name>.config.ts`

**操作**:
1. 读取主库的 `prisma.config.ts`，获取项目的配置模式（路径风格、是否用 `__dirname`）
2. 复制结构，修改：
   - `contract`: 指向 `src/prisma/<db_name>/contract.ts`
   - `output`: 指向 `src/generated/<db_name>_db_client`
   - `db.connection`: 环境变量名改为 `<DB_NAME>_DATABASE_URL`，fallback 改为 `./<db_name>Db.db`
   - `migrations.dir`: 指向 `src/prisma/<db_name>/migrations`

---

### Step 3: 创建 Runtime Factory

**职责**: 连接数据库、应用 middleware、实例化 ORM client、包装成 model wrappers

**文件**: `packages/common/src/utils/prisma/<db_name>Runtime.js`

**操作**:
1. 读取主库的 runtime 文件（`utils/prisma/index.js` 或类似），理解项目的 runtime 模式
2. 复制以下逻辑并调整：
   ```javascript
   import contractJson from '../../generated/<db_name>_db_client/contract.json'
   import { create<DbName>Models } from '../../models' // 见 Step 5
   
   export const <db_name>Db = sqlite({ 
     contractJson, 
     middleware: [sqliteTypeMiddleware] // 如果主库用了
   })
   
   export async function get<DbName>Prisma(ctx) {
     // 检查 global cache（避免重复连接）
     if (global.<db_name>Runtime) return global.<db_name>Runtime
     
     // 获取路径
     const dbPath = ctx.get<DbName>DBPath() // 见 Step 7
     
     // 连接
     const runtime = await <db_name>Db.connect({ path: dbPath })
     
     // 创建 ORM client
     const context = <db_name>Db.context
     const client = orm({ runtime, context })[UNBOUND_NAMESPACE_ID]
     
     // 包装 models
     const models = create<DbName>Models(client, <db_name>Db)
     
     const result = { ...models, client, runtime, db: <db_name>Db }
     global.<db_name>Runtime = result
     return result
   }
   ```

**关键点**:
- 函数名用 PascalCase（`getLogsPrisma`、`getCachePrisma`）
- 用 `global` cache 避免重复连接

---

### Step 4: 创建 Migration Runner

**职责**: 在 Electron 主进程中应用迁移（Prisma v8 不用 CLI，用 ControlClient）

**文件**: `packages/common/src/utils/prisma/<db_name>RunPrismaCommand.js`

**操作**:
1. 读取主库的 migration runner（`runPrismaCommand.js`）
2. 复制逻辑并调整：
   ```javascript
   import contractJson from '../../generated/<db_name>_db_client/contract.json'
   
   export default async function run<DbName>PrismaCommand(param) {
     const { ctx } = param
     const target = ctx.get<DbName>DBPath()
     const migrationsDir = resolve<DbName>MigrationsDir(ctx) // 见下方
     
     const controlClient = createSqliteControlClient()
     await controlClient.connect(target)
     
     const result = await controlClient.dbUpdate({
       contract: contractJson,
       mode: 'apply',
       migrationsDir,
     })
     
     // 错误处理...
   }
   
   function resolve<DbName>MigrationsDir(ctx) {
     if (typeof ctx.get<DbName>MigrationsDir === 'function') {
       return ctx.get<DbName>MigrationsDir()
     }
     // fallback: 相对主库 migrations 推断
   }
   ```

---

### Step 5: 创建 Model Wrappers

**职责**: 为每个模型提供业务友好的 CRUD 方法（v8 的 ORM API 较底层）

**文件**: `packages/common/src/models/<Model1>Model.js` (每个模型一个文件)

**操作**:
1. 读取主库的一个 model wrapper（如 `AccountModel.js`），理解项目的封装模式
2. 为新库的每个模型创建类似文件：
   ```javascript
   export const get<Model1>Model = (client, db) => ({
     modelName: '<Model1>',
     
     create: async function(data = {}) {
       try {
         const record = await client.<Model1>.create({
           id: crypto.randomUUID(), // 或 client 生成
           ...data
         })
         return { <camelCase>: record, error: null }
       } catch (error) {
         return { <camelCase>: null, error: error.message }
       }
     },
     
     where: async function(clause = {}, limit = null, orderBy = null) {
       let query = client.<Model1>.where(clause)
       if (orderBy) {
         const [key, direction] = Object.entries(orderBy)[0]
         query = query.orderBy((a) => a[key][direction]())
       }
       if (limit) query = query.limit(limit)
       return await query.all()
     },
     
     // 其他方法: get、update、delete、count ...
   })
   ```

3. 在 `packages/common/src/models/index.js` 中添加：
   ```javascript
   import { get<Model1>Model } from './<Model1>Model.js'
   import { get<Model2>Model } from './<Model2>Model.js'
   
   export function create<DbName>Models(client, db) {
     return {
       <Model1>: get<Model1>Model(client, db),
       <Model2>: get<Model2>Model(client, db),
     }
   }
   ```

---

### Step 6: 扩展 Facade（统一导出）

**职责**: 将新库的 API 导出给 Electron 主进程

**文件**: `packages/common/src/facade.js`

**操作**:
1. 读取文件，找到顶部的 `require()` 块和底部的 `Facade` 对象
2. 在顶部添加：
   ```javascript
   const <db_name>Module = require('./utils/prisma/<db_name>Runtime')
   const get<DbName>Prisma = <db_name>Module.get<DbName>Prisma || <db_name>Module.default || <db_name>Module
   const run<DbName>PrismaCommand = require('./utils/prisma/<db_name>RunPrismaCommand')
   ```
3. 在 `Facade` 对象中添加：
   ```javascript
   get<DbName>Prisma,
   run<DbName>PrismaCommand,
   <DB_NAME>_DB_FILE_NAME: '<db_name>Db.db',
   ```

---

### Step 7: 扩展类型声明

**职责**: 让 TypeScript 识别新库的类型和接口

**文件**: `packages/common/src/types.d.ts`

**操作**:
1. **添加导入**（在文件顶部，主库导入之后）：
   ```typescript
   import type {
     Models as <DbName>Models,
     Contract as <DbName>Contract,
   } from './generated/<db_name>_db_client/contract'
   ```

2. **导出模型类型**（在主库类型导出之后）：
   ```typescript
   export type { <DbName>Models, <DbName>Contract }
   export type <Model1> = <DbName>Models.<Model1>
   export type <Model2> = <DbName>Models.<Model2>
   ```

3. **扩展 Prisma.ModelName**（找到现有的联合类型定义）：
   ```typescript
   export type ModelName = 
     | 'Account' | 'Thread' | ... // 现有的
     | '<Model1>' | '<Model2>'    // 新增的
   ```

4. **扩展 IContextDB 接口**（添加路径获取方法）：
   ```typescript
   export interface IContextDB {
     getDBPath(): string
     getMigrationsDir?: () => string
     // ... 现有的方法
     get<DbName>DBPath?: () => string
     get<DbName>MigrationsDir?: () => string
   }
   ```

5. **扩展 IFacade 接口**（添加新库的运行时和常量）：
   ```typescript
   export interface IFacade {
     getPrisma: TypeGetPrisma
     get<DbName>Prisma: (ctx: IContextDB) => Promise<{
       <Model1>: any
       <Model2>: any
       client: any
       runtime: any
       db: any
     }>
     runPrismaCommand: TypeRunPrismaCommand
     run<DbName>PrismaCommand: TypeRunPrismaCommand
     DB_FILE_NAME: string
     <DB_NAME>_DB_FILE_NAME: string
   }
   ```

---

### Step 8: Electron 主进程集成

#### 8.1 创建数据库初始化模块

**文件**: `apps/desktop/src/main/utils/<db_name>Db.ts`

**操作**:
参考主库的 `db.ts`，创建类似结构：
```typescript
import fs from 'node:fs'
import path from 'node:path'
import * as commonFacade from '@app/common'
import { dbContext } from './dbContext'

const { get<DbName>Prisma, run<DbName>PrismaCommand } = commonFacade as any
const <DB_NAME>_DB_FILE_NAME = '<db_name>Db.db'

let resolve<DbName>Ready: () => void
const <db_name>Ready = new Promise<void>((resolve) => {
  resolve<DbName>Ready = resolve
})

let <db_name>PrismaPromise: ReturnType<typeof get<DbName>Prisma> | null = null

export async function init<DbName>DB() {
  try {
    const dbPath = /* 从 dbContext 获取 */
    const dbExists = fs.existsSync(dbPath)
    
    if (!dbExists) {
      console.log('<DbName> DB not found, creating:', dbPath)
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      fs.closeSync(fs.openSync(dbPath, 'w'))
    }
    
    await run<DbName>PrismaCommand({ ctx: dbContext })
    <db_name>PrismaPromise = get<DbName>Prisma(dbContext)
    await <db_name>PrismaPromise
    
    console.log('✓ <DbName> DB ready')
    resolve<DbName>Ready()
  } catch (error) {
    console.error('<DbName> DB init failed:', error)
    resolve<DbName>Ready() // 不阻塞应用启动
  }
}

export async function handle<DbName>Action(_, model: string, action: string, ...args: unknown[]) {
  await <db_name>Ready
  if (!<db_name>PrismaPromise) throw new Error('<DbName> DB not initialized')
  
  const prisma = await <db_name>PrismaPromise
  const modelWrapper = prisma[model]
  if (!modelWrapper) throw new Error(`Model ${model} not found in <DbName> DB`)
  if (typeof modelWrapper[action] !== 'function') throw new Error(`Action ${action} not found`)
  
  return modelWrapper[action](...args)
}
```

#### 8.2 扩展 utils/index.ts

在该文件末尾添加：
```typescript
export { handle<DbName>Action, init<DbName>DB } from './<db_name>Db'
```

#### 8.3 扩展 dbContext.ts

读取现有的 `dbContext` 对象，在其末尾（闭合 `}` 之前）添加：
```typescript
get<DbName>DBPath: () =>
  isDev
    ? path.posix.resolve(`../../packages/common/src/storage/<db_name>Db.db`)
    : path.join(app.getPath("userData"), "<db_name>Db.db"),

get<DbName>MigrationsDir: () =>
  isDev
    ? path.join(
        app.getAppPath().replace("app.asar", "app.asar.unpacked"),
        "../../packages/common/src/prisma/<db_name>/migrations",
      )
    : path.resolve(
        app.getAppPath().replace("app.asar", ""),
        "prisma/<db_name>/migrations",
      ),
```

#### 8.4 扩展 main/index.ts

**修改 1**: 导入新库的初始化函数和 handler
```typescript
import { initDB, handlePersistenceAction, init<DbName>DB, handle<DbName>Action } from './utils'
```

**修改 2**: 注册 IPC handler（在现有的 `ipcMain.handle(...)` 之后）
```typescript
ipcMain.handle('llm:<db_name>-action', handle<DbName>Action)
```

**修改 3**: 在 `initDB().then(...)` 内调用新库初始化
```typescript
initDB().then(() => {
  global.isDBReady = true
  init<DbName>DB().catch(err => console.error('<DbName> DB init failed:', err))
})
```

---

### Step 9: Electron Preload & Renderer

#### 9.1 扩展 preload/index.ts

读取 `api` 对象定义，在 `persistenceAction` 之后添加：
```typescript
<db_name>Action: (model: string, action: string, ...args: any[]) =>
  ipcRenderer.invoke('llm:<db_name>-action', model, action, ...args),
```

#### 9.2 Renderer 使用示例（可选）

在 `App.vue` 或其他组件中：
```typescript
// 调用新库的 API
const result = await window.api.<db_name>Action('<Model1>', 'create', {
  field1: 'value1',
  timestamp: new Date(),
})

if (result.error) {
  console.error('Failed:', result.error)
} else {
  console.log('Success:', result.<camelCase>)
}

// 查询
const records = await window.api.<db_name>Action('<Model1>', 'where', { field1: 'value1' }, 10)
```

---

### Step 10: 构建配置

#### 10.1 添加 npm 脚本

**文件**: `packages/common/package.json`

在 `scripts` 对象中添加：
```json
"db:generate:<db_name>": "prisma contract emit --config ./prisma.<db_name>.config.ts",
"db:migrate:<db_name>": "prisma db update --config ./prisma.<db_name>.config.ts --confirm <db_name>Db.db",
"db:studio:<db_name>": "prisma studio --config ./prisma.<db_name>.config.ts"
```

#### 10.2 扩展 build.mjs

**文件**: `packages/common/build.mjs`

找到主库的 `copyDir(...)` 调用（复制 migrations 和 generated client），在其后添加对应的新库复制：

```javascript
// 在 copyDir(...'prisma/migrations', ...) 之后
copyDir(
  path.join(srcDir, 'prisma/<db_name>/migrations'),
  path.join(dist, 'prisma/<db_name>/migrations')
)

// 在 copyDir(...'generated/db_client', ...) 之后
copyDir(
  path.join(srcDir, 'generated/<db_name>_db_client'),
  path.join(dist, 'generated/<db_name>_db_client')
)
```

---

## 验证清单

完成扩展后，按顺序执行以下命令：

### 1. 生成客户端
```bash
cd packages/common
pnpm db:generate:<db_name>
```
**预期**: 生成 `src/generated/<db_name>_db_client/` 目录，无报错

### 2. 创建数据库和迁移
```bash
pnpm db:migrate:<db_name>
```
**预期**:
- 生成 `src/prisma/<db_name>/migrations/app/refs/db.json`
- 生成 `src/prisma/<db_name>/migrations/snapshots/{hash}/contract.json`
- 创建 `src/storage/<db_name>Db.db` 文件

### 3. 构建 common 包
```bash
pnpm common build
```
**预期**: 构建成功，`dist/` 包含新库的 migrations 和 generated client

### 4. TypeScript 检查
```bash
pnpm desktop typecheck
```
**预期**: 无类型报错

### 5. 运行应用
```bash
pnpm dev
```
**预期**:
- 应用启动成功
- 控制台显示 `✓ <DbName> DB ready`
- 可以从 DevTools 调用 `window.api.<db_name>Action(...)`

### 6. 检查文件
```bash
ls packages/common/src/storage/      # 应有 myDb.db 和 <db_name>Db.db
ls packages/common/dist/prisma/      # 应有 migrations 和 <db_name>/migrations
```

---

## 维护同步策略

### 问题
主库代码变化后，本文档的描述可能过时（如主库改用不同的 runtime 模式）。

### 解决方案
1. **本文档只描述"在哪里、加什么"，不粘贴现有代码**
   - AI 执行时必须读取实时文件，理解当前模式后再生成新代码
   - 这样主库重构后，AI 自动适配新模式

2. **维护参考分支**（可选）
   - 保留一个 `example/multi-db` 分支，展示完整的两库状态
   - 主库重构后，重新在新分支执行本文档，对比差异

3. **测试脚本**（未实现）
   - 写一个 `scripts/test-multi-db-guide.sh`，让 AI 从头执行本文档
   - 定期运行确保文档仍然有效

---

## 进一步扩展

### 添加第 3、4、N 个数据库
完全重复本文档的步骤，用新的 `<DB_NAME>` 占位符替换。

### 跨库数据一致性
SQLite 不支持跨文件事务，如果需要：
- **方案 1**: 在应用层实现补偿事务（一个失败则回滚另一个）
- **方案 2**: 用消息队列解耦（一个库写入后，异步触发另一个库的操作）
- **方案 3**: 重新评估是否真的需要拆库

### 生产环境注意事项
1. **备份**: 不同库可能需要不同备份频率（用户数据 vs 日志）
2. **监控**: 分别监控各库的文件大小、写入 QPS
3. **错误隔离**: 一个库失败不应阻止其他库工作（见 Step 8.1 的 catch 逻辑）
4. **迁移**: 考虑添加"库版本号"表，用于未来的跨库迁移

---

**文档版本**: 2.0.0  
**最后更新**: 2026-09-24  
**适用**: Prisma v8 (@prisma/orm-sqlite), Electron, pnpm monorepo
