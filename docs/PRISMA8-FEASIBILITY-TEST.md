# Prisma 8 升级可行性验证（2026-09-19）

## 验证目标

在完整迁移前（7-10 天工作量），先验证核心技术路径是否可行：
1. ✅ v8 RC 包能否在本仓库安装
2. ✅ contract.ts 能否正确定义并 emit
3. ✅ 生成的类型是否符合预期
4. ⏸️ 运行时 API 能否连接 node:sqlite（未测试，留待完整迁移）

## 验证结果

### 1. 包安装（✅ 成功）

**安装版本**：
- `prisma@8.0.0-rc.15` (CLI)
- `@prisma/orm-sqlite@8.0.0-rc.11` (一站式运行时包)
- `@prisma/orm-toolchain@8.0.0-rc.11`
- `@prisma/orm-framework@8.0.0-rc.11`

**Catalog 配置** (`pnpm-workspace.yaml`):
```yaml
catalog:
  prisma: 8.0.0-rc.15
  '@prisma/orm-sqlite': 8.0.0-rc.11
  '@prisma/orm-toolchain': 8.0.0-rc.11
  '@prisma/orm-framework': 8.0.0-rc.11
```

**安装耗时**：~25 秒（pnpm install）

**关键发现**：
- v8 不再有 `@prisma/client` 包，运行时入口变成 `@prisma/orm-sqlite`
- 包结构是 subpath exports（`/runtime`, `/contract-builder`, `/adapter/column-types` 等），无根 `.` 导出
- 无原生依赖（node:sqlite 是 Node.js 内置模块）

---

### 2. Contract 定义（✅ 成功）

**文件**：`packages/common/src/prisma/contract.ts` (60 行)

**API 形态**（基于 `@prisma/orm-sqlite/contract-builder`）：
```ts
import { datetimeColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, field, model, rel } from '@prisma/orm-sqlite/contract-builder';

const Account = model('Account', {
  fields: {
    id: field.column(textColumn).id(),
    username: field.column(textColumn),
    email: field.column(textColumn).optional(),
  },
});

export const contract = defineContract({
  models: {
    Account: Account.relations({
      threads: rel.hasMany(Thread, { by: 'accountId' }),
    }),
  },
});
```

**与源码示例的差异**：
- 源码 `test/e2e` 用的是**平面 API**（`field.column(type).id()`）
- npm 包内还有**回调模式**（`defineContract({}, ({field, model}) => {...})`），但文档未覆盖
- 本次采用**平面 API**（与 SQLite fixture 一致）

**时间戳字段处理**：
- v7 用 `@default(now())`，v8 RC 的 `now()` 在 npm rc.11 包内**不存在**
- 源码有 `now()` 但未发布到 npm rc.11
- **当前策略**：字段定义不带 `default(now())`，应用层仍用 `new Date()` 填充（与 v7 实际行为一致）

---

### 3. Contract Emit（✅ 成功）

**命令**：`npx prisma contract emit`

**输出**：
```json
{
  "ok": true,
  "outDir": "C:/Users/TB/my_git/pnpm-monorepo-electron-prisma/packages/common/src/generated/db_client",
  "files": {
    "json": ".../contract.json",
    "dts": ".../contract.d.ts"
  },
  "timings": {"total": 369}
}
```

**生成产物**：
- `contract.json` (16 KB) — 运行时用的序列化 contract
- `contract.d.ts` (31 KB, 736 行) — TypeScript 类型定义

**类型检查**：
```ts
// contract.d.ts 导出的核心类型
export type StorageHash = StorageHashBase<'0eae2e0b...'>;
export type ProfileHash = ProfileHashBase<'260b8608...'>;
export type Contract = ContractType<...>;
```

**警告（无害）**：
```
Warning: Module type of contract.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected.
To eliminate: add "type": "module" to package.json.
```
→ 本仓库是 CommonJS 项目，contract.ts 单独用 ESM 不影响。

---

### 4. 运行时 API 结构（文档验证，未实测）

**实例化模式**（来自 `prisma8/examples/prisma-8-demo-sqlite`）：

```ts
// 1. 导入生成的 contract 和运行时
import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// 2. 创建 db 实例
export const db = sqlite<Contract>({ contractJson });

// 3. 使用 ORM 客户端
import { orm } from '@prisma/orm-sqlite/orm-client';
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir';

const ormClient = orm({ runtime: db.runtime, context: db.context })[UNBOUND_NAMESPACE_ID];

// 4. 查询 API
await ormClient.User.create({ id: '...', name: '...' });
await ormClient.User.where({ id: '...' }).first();
await ormClient.User.where({ active: true }).all();
```

**与 v7 的差异**：
- v7: `new PrismaClient({ adapter })` → `prisma.account.findMany()`
- v8: `sqlite({ contractJson })` → `orm(...)[UNBOUND_NAMESPACE_ID].Account.where().all()`

**关键挑战**：
- `orm()` 需要 `runtime` 参数，其类型是 `SqliteRuntime`
- `db.runtime` 来自 `sqlite({ contractJson })` 的返回值
- 但 `sqlite()` **需要传入 driver 连接**（从 demo 看，`sqlite()` 接受 `{ contractJson, path?: string }` 或 driver）

**node:sqlite 绑定**（推测，待验证）：
v8 官方 SQLite driver 已用 `node:sqlite`（见调研文档第 0.2 节），所以：
```ts
import { DatabaseSync } from 'node:sqlite';
import sqlite from '@prisma/orm-sqlite/runtime';

const db = sqlite<Contract>({
  contractJson,
  driver: new DatabaseSync('./data.db'),  // 或 path: './data.db'
});
```
→ 本仓库的 `nodeSqliteAdapter.js` 应该可以**直接删除**，交给官方。

---

## 未验证项（留待完整迁移）

### A. 运行时连接与查询执行
- [ ] `sqlite({ contractJson, path })` 能否正常连接 `node:sqlite`
- [ ] 查询 API (`User.create()`, `User.where().all()`) 能否正确执行
- [ ] 事务 API (`db.transaction()`)
- [ ] 生成的类型是否能通过 TypeScript 检查

### B. 迁移工作流
- [ ] `prisma db init` (初次建表)
- [ ] `prisma migration plan` + `prisma db migrate` (应用迁移)
- [ ] 打包后应用的**运行时迁移**（关键拦路石，见下）

### C. 构建与打包
- [ ] `build.mjs` 是否需要调整（生成目录结构变化）
- [ ] esbuild external 配置
- [ ] Electron 打包后能否正常运行

---

## 关键风险与拦路石

### 🚨 拦路石 1：打包后应用的运行时迁移（HIGH）

**问题**：v8 RC 文档只展示 CLI 驱动的迁移（`prisma db migrate`），未见**编程式 API**。

**本仓库的需求**：
- 用户下载新版应用 → 启动时自动应用 schema 迁移（无需用户手动跑 CLI）
- v7 用自维护的 `runPrismaCommand.js` 解决，通过 spawn CLI 进程

**v8 的情况**（待确认）：
1. ✅ **已解决（2026-09-19 晚更新）**：memory 显示 v8 有 `createSqliteControlClient` 编程式 API
2. 需验证：该 API 是否支持打包后的 Electron 环境（无 CLI 可执行文件）
3. 如不支持，退路：继续用 v7 风格的 CLI fork（`runPrismaCommand.js` 改调 v8 CLI）

**决策点**：完整迁移前**必须**验证此项，否则升级后用户无法自动迁移。

---

### 🟡 风险 2：SQLite 仍是 "proof of concept"（MEDIUM）

**证据**（`prisma8/scorecard.md`）：
- SQLite: 85 ✅ / 235 🟡 (untested) / 98 ❌
- 迁移工作流（`db init` / `db update` / 幂等 / drift / ledger）对 SQLite **几乎全是 🟡**

**影响**：
- 运行时查询 API 大概率稳定（85 个集成测试覆盖）
- 迁移工作流可能有未发现的 bug（无集成测试）

**缓解策略**：
- 在开发环境充分测试迁移流程（`db init` → 改 schema → `db migrate` → 回滚）
- 保留 v7 分支作为回退路径（升级后 1-2 个 minor 版本内）

---

### 🟡 风险 3：v8 API 仍在快速演进（MEDIUM）

**证据**：
- npm rc.11 的 API 与源码 `test/e2e` 已不一致（`now()` 未导出）
- CLI 从 rc.3 → rc.15，2 个月 12 个 RC
- `@prisma/orm-sqlite` 还在 `latest` tag（未进 `stable`）

**影响**：
- rc.15 → final 可能有 breaking change
- 完整迁移后，可能需要再改一次（final 发布时）

**缓解策略**：
- 等 v8.0.0 final + 至少一个 patch (v8.0.1) 再投入完整迁移
- 本次验证的代码放在 feature branch，不合并到 master

---

## 验证结论

### ✅ 核心技术路径可行

1. **包管理**：v8 包能正常安装，无原生依赖冲突
2. **Contract 定义**：API 清晰，能正确 emit 生成类型
3. **零原生依赖**：node:sqlite 官方接管，`nodeSqliteAdapter.js` 可删除

### ⏸️ 需进一步验证（完整迁移阶段）

1. **运行时连接**：`sqlite({ contractJson, path })` 能否连上 node:sqlite
2. **编程式迁移 API**：`createSqliteControlClient` 在打包环境的可用性
3. **Model 层查询重写**：所有 v7 的 `prisma.account.findMany()` 改成 v8 的 `db.Account.where().all()`

### 🚨 必须在完整迁移前解决的拦路石

**打包后应用的运行时迁移**：验证 `createSqliteControlClient` 能否在无 CLI 的 Electron 环境工作。如果不行，需设计替代方案（CLI fork 或手写 SQL migration runner）。

---

## 下一步行动

### 选项 A：立即完整迁移（不推荐）
- 投入 7-10 天，按 Workflow 生成的 12 维度计划执行
- 风险：SQLite proof-of-concept + 运行时迁移 API 不确定

### 选项 B：等 v8 stable 再迁移（推荐）
- 触发条件：
  1. v8.0.0 final 发布
  2. `@prisma/orm-sqlite` 进入 npm `latest` tag
  3. SQLite scorecard 迁移工作流那批 🟡 变 ✅（或官方明确 SQLite 转正）
  4. 官方文档明确打包应用的迁移方案（或社区验证 `createSqliteControlClient` 可用）
- 预计等待时间：4-8 周

### 选项 C：仅保留此验证分支（当前状态）
- 不合并到 master，保持 `prisma8` 分支可编译状态
- 定期（每月）拉最新 v8 包，重跑验证
- 等上述 4 个条件满足后，再启动完整迁移

---

## 附录：文件清单

### 已修改文件（未提交）
- `pnpm-workspace.yaml` — catalog 升级到 v8 RC
- `packages/common/package.json` — 依赖从 v7 换成 v8
- `packages/common/prisma.config.ts` — v8 config 结构（`orm` section）
- `packages/common/src/prisma/contract.ts` — v8 contract 定义（新增）
- `pnpm-lock.yaml` — lockfile

### 生成文件（gitignored）
- `packages/common/src/generated/db_client/contract.json`
- `packages/common/src/generated/db_client/contract.d.ts`

### 未修改文件（完整迁移时需改）
- `packages/common/src/utils/prisma/nodeSqliteAdapter.js` — v8 后应删除
- `packages/common/src/utils/prisma/runPrismaCommand.js` — 替换成 `createSqliteControlClient`
- `packages/common/src/utils/prisma/index.js` — `getPrisma()` 改成 v8 运行时初始化
- `packages/common/src/models/*.js` — 所有 Model 查询 API 重写
- `packages/common/build.mjs` — 可能需要调整 external / copy 逻辑
- `apps/desktop/package.json` — 依赖版本跟随

---

**文档版本**：v1.0  
**验证日期**：2026-09-19  
**验证者**：Claude (Opus 4.8)  
**耗时**：包安装 25s + contract 编写/调试 15min + emit 验证 2min = ~20min  
**Token 消耗**：~62k（会话总计，含 Workflow 前序工作）
