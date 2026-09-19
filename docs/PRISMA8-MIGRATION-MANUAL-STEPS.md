# Prisma 8 完整迁移手动步骤（阶段2）

## 已通过 Workflow 自动处理

- ✅ `packages/common/src/utils/prisma/index.js` — getPrisma() 改写为 v8 runtime
- ✅ `packages/common/src/models/AccountModel.js` — v7 → v8 query API
- ✅ `packages/common/src/models/ThreadModel.js` — v7 → v8 query API  
- ✅ `packages/common/src/models/ThreadMessageModel.js` — v7 → v8 query API

## 需手动处理的文件

### 1. `packages/common/src/utils/prisma/facade.js`

**当前状态（第9行）**：
```javascript
export { PrismaClient, Prisma } from '../../generated/db_client/client';
```

**问题**：v8 没有 `PrismaClient` 和 `Prisma` 导出，这是 v7 遗留

**方案 A（推荐）**：删除整个文件，检查是否有其他模块 import 它
**方案 B**：如果有依赖，改为 re-export v8 的 `Contract` 类型

---

### 2. `packages/common/build.mjs`

**当前状态（第29行）**：
```javascript
external: ['@prisma/client', 'uuid'],
```

**需改为**：
```javascript
external: ['@prisma/orm-sqlite', 'uuid'],
```

**原因**：v8 的 runtime 包从 `@prisma/client` 变成 `@prisma/orm-sqlite`

---

### 3. `packages/common/src/utils/prisma/nodeSqliteAdapter.js`

**当前状态**：104 行，v7 自定义 node:sqlite 适配器

**问题**：v8 官方已内置 node:sqlite 支持，此文件已过时

**方案 A（推荐）**：直接删除文件
**方案 B**：如果测试依赖它，保留但标记 deprecated

**依赖它的文件**：
- `test/utils/prisma/nodeSqliteAdapter.test.js` (3个测试)
- `test/utils/prisma/nodeSqliteDbAdapter.test.js` (3个测试)
- `test/utils/prisma/nodeSqliteDbEngine.test.js` (3个测试)

---

### 4. `packages/common/src/utils/prisma/runPrismaCommand.js`

**当前状态**：v7 通过 fork CLI 进程执行迁移的工具

**替代方案**：v8 的 `createSqliteControlClient` 编程式 API

**新实现示例**（基于 v8 API）：
```javascript
import { createSqliteControlClient } from '@prisma/orm-sqlite/control';

export async function runMigration(dbPath) {
  const client = createSqliteControlClient({ connection: dbPath });
  
  try {
    await client.connect();
    const result = await client.dbUpdate({ mode: 'apply' });
    
    if (!result.ok) {
      throw new Error(`Migration failed: ${result.error.code}`);
    }
    
    return result.value;
  } finally {
    await client.close();
  }
}
```

**ControlClient API 要点**（已验证）：
- `createSqliteControlClient({ connection?: string })` — 创建客户端
- `client.connect(connection?)` — 连接数据库（可选，如构造时已传 connection）
- `client.dbInit({ mode: 'plan' | 'apply' })` — 初次建表
- `client.dbUpdate({ mode: 'plan' | 'apply' })` — 更新 schema（自动检测差异）
- `client.close()` — 关闭连接

---

### 5. `packages/common/src/generated/db_client/` 遗留 v7 文件

**需删除的 v7 生成文件**：
- `browser.ts`
- `client.ts`
- `commonInputTypes.ts`
- `enums.ts`
- `models.ts`
- `internal/` 目录
- `models/` 目录

**保留的 v8 文件**：
- `contract.d.ts` (v8 生成)
- `contract.json` (v8 生成)

**执行命令**：
```bash
cd packages/common/src/generated/db_client
rm -rf browser.ts client.ts commonInputTypes.ts enums.ts models.ts internal/ models/
```

---

### 6. `packages/common/package.json` scripts

**当前 `db:migrate` script**：
```json
"db:migrate": "prisma db update --yes"
```

**验证要点**：
- `prisma db update` 在 v8 中仍然有效
- `--yes` flag 是否仍存在（需验证 CLI）

**可能需要改为**：
```json
"db:migrate": "prisma db update --mode=apply"
```

---

### 7. 类型定义文件（如果存在 `.d.ts` 文件引用 v7 类型）

**需搜索并替换**：
- 搜索：`@prisma/client` 的 import
- 替换为：从 `@prisma/orm-sqlite` 或生成的 `contract.d.ts` import

**搜索命令**：
```bash
grep -r "from '@prisma/client'" packages/common/src --include="*.ts" --include="*.d.ts"
```

---

## 验证步骤

完成上述修改后，按顺序验证：

1. **类型检查**：
   ```bash
   cd packages/common
   npx tsc --noEmit
   ```

2. **构建**：
   ```bash
   pnpm run build
   ```

3. **测试**（如果有）：
   ```bash
   pnpm test
   ```

4. **运行时验证**：
   - 启动应用，测试数据库连接
   - 测试 CRUD 操作
   - 测试迁移流程（新版应用首次启动）

---

## 🚨 关键：desktop 主进程 db.ts 深度耦合 v7

### 8. `apps/desktop/src/main/utils/db.ts`

**使用了 v7 专属 API**（v8 均不存在）：
- 第3行：`import type { PrismaClient } from "@app/common"` — v8 无此类型
- 第16行：`const prisma: PrismaClient = getPrisma(dbContext)` — v8 返回的是 ORM client，非 PrismaClient
- 第109行：`await prisma.$queryRaw\`select * from _prisma_migrations...\`` — v8 无 `$queryRaw`
- 第139行：`await prisma.$disconnect()` — v8 无 `$disconnect`
- 第152行：`await prisma.$connect()` — v8 无 `$connect`

**迁移影响**：
- `initDB()` 的整个迁移检测逻辑（读 `_prisma_migrations` 表）需重写
  - v8 用自己的 marker/ledger 机制（不是 `_prisma_migrations` 表）
  - 应改用 `client.verify()` 或 `client.dbUpdate({ mode: 'plan' })` 检测是否需要迁移
- `$disconnect()` / `$connect()` 的连接管理需替换为 v8 runtime 的生命周期
- `$queryRaw` 原始查询需改用 v8 的 raw query API（如果有）

**重写策略**：
```typescript
import { createSqliteControlClient } from '@prisma/orm-sqlite/control';

export async function initDB() {
  const client = createSqliteControlClient({ connection: `file:${dbPath}` });
  try {
    await client.connect();
    // v8 自动检测差异并应用（幂等）
    const result = await client.dbUpdate({ mode: 'apply' });
    if (!result.ok) throw new Error(`Migration failed: ${result.error.code}`);
    console.log('√ Migration done.');
  } finally {
    await client.close();
    resolveDBReady();
  }
}
```
→ v8 的 `dbUpdate` 是幂等的，不需要手工比对 migration 时间戳！简化了整个 initDB 逻辑。

---

### 9. `apps/desktop/src/renderer/src/utils/index.ts`

**使用了 v7 类型**（第1、4行）：
```typescript
import type { Prisma } from '@app/common'
export function getDBModelProxy<T extends Prisma.ModelName>(modelName: Prisma.ModelName) {
```

**问题**：v8 无 `Prisma.ModelName` 联合类型

**方案**：从 v8 生成的 `contract.d.ts` 提取模型名类型，或手写：
```typescript
type ModelName = 'Account' | 'Thread' | 'ThreadMessage';
```

---

### 10. `packages/common/src/facade.js` 的 IFacade 类型

**facade.js 导出**（第9、20-21行）：
```javascript
const { PrismaClient, Prisma } = require('./generated/db_client/client');
// ...
PrismaClient, Prisma  // 导出给 desktop 使用
```

**问题**：`types.d.ts` 中的 `IFacade` 接口定义了 `PrismaClient` 和 `Prisma` 字段，desktop 依赖它们

**方案**：
1. 从 facade.js 移除 `PrismaClient` / `Prisma` 导出
2. 更新 `types.d.ts` 的 `IFacade` 接口
3. 更新 desktop 的类型引用

---

## 风险点

1. **desktop db.ts 深度耦合 v7 迁移语义**（最大风险）— `$queryRaw`/`$disconnect`/`$connect` + `_prisma_migrations` 表检测逻辑全部需重写
2. **测试套件依赖 nodeSqliteAdapter.js** — 3个测试文件，删除前需确认测试策略
3. **runPrismaCommand.js 被 Electron 主进程调用** — 需确保 `createSqliteControlClient` 在打包后（无 CLI）可用
4. **renderer 的 Prisma.ModelName 类型** — 需替换为 v8 等价类型或手写联合类型
5. **facade.js/types.d.ts 的 IFacade 契约** — 跨 package 的类型契约需同步更新

## 完整迁移涉及的文件清单（最终）

| 文件 | 处理方 | 状态 |
|------|--------|------|
| `packages/common/src/utils/prisma/index.js` | Workflow | 进行中 |
| `packages/common/src/models/Account.js` | Workflow | 进行中 |
| `packages/common/src/models/Thread.js` | Workflow | 进行中 |
| `packages/common/src/models/ThreadMessage.js` | Workflow | 进行中 |
| `packages/common/src/facade.js` | 手动 | 待处理 |
| `packages/common/src/types.d.ts` | 手动 | 待处理 |
| `packages/common/build.mjs` | 手动 | 待处理 |
| `packages/common/src/utils/prisma/nodeSqliteAdapter.js` | 手动删除 | 待处理 |
| `packages/common/src/utils/prisma/runPrismaCommand.js` | 手动重写 | 待处理 |
| `packages/common/src/generated/db_client/*` (v7遗留) | 手动删除 | 待处理 |
| `apps/desktop/src/main/utils/db.ts` | 手动重写 | 待处理 |
| `apps/desktop/src/renderer/src/utils/index.ts` | 手动 | 待处理 |
| 3个测试文件 | 手动 | 待处理 |

---

**文档版本**：v1.0  
**创建时间**：2026-09-19  
**状态**：等待 Workflow 完成后执行
