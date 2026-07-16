# Prisma 6 → 7 升级指南（node:sqlite 零原生依赖方案）

本文档记录本仓库从 Prisma 6.19.2 升级到 7.8.0 的完整决策、实现与踩坑。
目标：**打包后的 Electron 应用零原生依赖、零引擎二进制、零路径问题。**

---

## 1. 为什么这是一次重写，而非版本号升级

Prisma 6 的整套集成是围绕 **Rust query engine** 搭的（`engineType = "library"`、
`query_engine-windows.dll.node`、fork `schema-engine-windows.exe` 跑迁移）。

Prisma 7 把这个模型整个删掉了（"Rust-free"）：

| Prisma 6 | Prisma 7 |
|---|---|
| Rust query engine (`.dll.node`) | 删除，改 TypeScript query compiler + **强制 driver adapter** |
| `prisma-client-js` generator | 默认 `prisma-client`，生成 TS 到指定 `output`，不进 node_modules |
| `datasource` 块里 `url = env(...)` | url 移到 `prisma.config.ts`；运行时靠 adapter |
| schema-engine 二进制跑 migrate | 无引擎；迁移需自行处理 |

因此 Prisma 6 时代最脆弱的部分（在 `app.asar` 外定位引擎 `.dll.node`/`.exe`）
**整个消失**——这恰好是打包炸点最多的地方。代价是数据库集成层需要一次性重写。

---

## 2. 最终架构

```
┌───────────────────────────────────────────────────────────────┐
│ Electron 43 主进程  (Node 24 运行时，内置 node:sqlite)          │
│   apps/desktop/src/main/utils/                                 │
│   ├─ db.ts         initDB() + handlePersistenceAction()        │
│   ├─ dbContext.ts  只提供 getDBPath / getMigrationsDir         │
│   └─ 从 '@app/common' require { getPrisma, runPrismaCommand }  │
└───────────────────────────┬───────────────────────────────────┘
                            │ require（纯 CJS）
                            ▼
┌───────────────────────────────────────────────────────────────┐
│ @app/common/dist/index.js  （esbuild 打成单个 CJS，~1.4MB）    │
│   facade.js                                                    │
│   ├─ getPrisma(ctx) → new PrismaClient({ adapter })            │
│   │      └─ nodeSqliteAdapter.js → node:sqlite DatabaseSync    │
│   ├─ 生成的 Prisma 7 client (ESM/TS) —— 被 esbuild 内联         │
│   └─ runPrismaCommand(ctx) → 读 migration.sql → db.exec()      │
└───────────────────────────┬───────────────────────────────────┘
                            ▼
                     myDb.db (SQLite 文件)
```

**关键取舍**：底层 SQLite 驱动选了 Electron 内置的 `node:sqlite`（Node 22.5+ / Electron 43 = Node 24），
而不是官方推荐的 `@prisma/adapter-better-sqlite3`。原因：better-sqlite3 是原生模块，需针对
Electron ABI 重编译（Electron 43-beta 尤其麻烦）。node:sqlite 是内置模块，**零原生编译、
零 electron-rebuild、零 ABI 不匹配、零 asarUnpack 原生 .node**——直击"打包零依赖"诉求。

---

## 3. 三个关键技术坑（最容易重踩）

### 坑 1：`moduleFormat = "cjs"` 不生效

Prisma 7 的 `prisma-client` generator **永远产出 ESM TypeScript 源码**。实测：
- 设 `moduleFormat = "cjs"` —— 无效，入口仍是 `import ... from`
- 设 `generatedFileExtension = "js"` —— 生成 `.js` 文件但内容含 TS 类型语法，纯 rollup 解析报错

正确做法：schema 里**只保留 `output`（+可选 `runtime = "nodejs"`）**，用默认 `.ts` 输出，
交给 **TS-aware 打包器（esbuild）** 内联。本仓库 `@app/common` 原本是纯 rollup（无 TS 转换），
必须换成 esbuild（`packages/common/build.mjs`）。

### 坑 2：datasource `url` 必须从 schema 删除

Prisma 7 下 schema 里保留 `url = env("DATABASE_URL")` 会报 **P1012**：
`The datasource property 'url' is no longer supported in schema files`。
连接改由运行时 adapter 提供，CLI 用 `prisma.config.ts`。

### 坑 3：node:sqlite 的错误对象形状 ≠ better-sqlite3

移植官方 better-sqlite3 adapter 的错误映射时，这是**唯一**的实质差异：

| | better-sqlite3 | node:sqlite |
|---|---|---|
| `error.code` | `'SQLITE_CONSTRAINT_UNIQUE'`（字符串） | `'ERR_SQLITE_ERROR'`（恒定） |
| 真正的扩展码 | 在 `error.code` | 在 `error.errcode`（整数） |
| `error.message` | `UNIQUE constraint failed: t.id` | 格式相同 ✅ |

SQLite 扩展码常量：`2067`=UNIQUE、`1555`=PRIMARYKEY、`787`=FOREIGNKEY、`1811`=TRIGGER、
`1299`=NOTNULL、`5`/`517`=BUSY。`nodeSqliteAdapter.js` 的 `mapDriverError` 按 `errcode`
整数分支（并兼容 better-sqlite3 字符串码作回退），修好后唯一约束正确映射为 P2002。

**node:sqlite ↔ better-sqlite3 的 API 对应**（其余全部同构，可原样移植转换逻辑）：

| better-sqlite3 | node:sqlite |
|---|---|
| `stmt.raw().all()` | `stmt.setReturnArrays(true); stmt.all()` |
| `db.defaultSafeIntegers(true)` | `stmt.setReadBigInts(true)` |
| `stmt.columns()` → `{name, type}` | 相同（`type` = 声明类型） |
| `stmt.run()` → `{changes, lastInsertRowid}` | 相同 |
| `db.exec(script)` | 相同 |
| BLOB 类型 | ArrayBuffer → 也需处理 `Uint8Array` |

---

## 4. 迁移方案：运行时直接执行 SQL

`runPrismaCommand`（`packages/common/src/utils/prisma/runPrismaCommand.js`）不再 fork CLI，
改为：读 `src/prisma/migrations/*/migration.sql`（按目录名排序）→ 用 node:sqlite `db.exec()`
执行 → 在 `_prisma_migrations` 表记录已应用（字段结构复刻 Prisma，使 db.ts 的
`select * from _prisma_migrations` 检查继续可用）。幂等：已记录的迁移跳过。

**好处**：不随包塞 schema-engine + prisma CLI；无子进程（无环境变量/路径/权限坑）；启动更快；迁移逻辑透明。

**代价/风险**：
- **checksum 算了但从不校验**（见第 9 节偏差 M2）——只做向前 apply，不做 Prisma 官方那种 drift/checksum 一致性校验（对桌面 app 单向 schema 演进够用）
- migration.sql 必须是可直接执行的纯 SQL（SQLite 天然如此）
- `_prisma_migrations` 表结构需自行维护正确
- 开发期建迁移（`prisma migrate dev`）仍用官方 CLI —— 不变也不应变

---

## 5. 打包（electron-builder）网络关卡

Windows 打包在受限网络（尤其有 VPN/网络准入客户端时）会连续撞几堵墙，逐一解法如下：

1. **`prisma` CLI 必须放 devDependencies**，不能放运行时 `dependencies`。
   否则 electron-builder 扫生产依赖闭包时会看到 `prisma` 的**可选 peer `better-sqlite3`**，
   试图 rebuild 一个根本没安装的原生模块，node-gyp 失败。
   （`@prisma/client`、`@prisma/driver-adapter-utils` 留在 dependencies。）

2. **electron 二进制下载**：electron-builder 用自己的 `app-builder.exe` 从 github 下 electron zip，
   **不读 `.npmrc` 镜像**。解法：`--config.electronDist=<已解压的 electron dist 目录>`
   直接指向本地 `node_modules/.pnpm/electron@.../electron/dist`，完全跳过下载。

3. **winCodeSign / nsis 二进制**：走环境变量 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
   （`.npmrc` 里的 `electron_builder_binaries_mirror` 对 app-builder 无效）。

4. **winCodeSign 解压失败（Windows 特权）**：该包含 macOS 符号链接（`darwin/.../libcrypto.dylib`
   等），7za 在 Windows 上创建符号链接需管理员/开发者模式，普通权限失败并中止整个打包。
   而这些 .dylib 是 mac 签名用的，Windows 打包**根本不需要**。
   解法：手动把 zip 解压到缓存目录 `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/`
   （app-builder 的 `dirName` = `winCodeSign-2.6.0`），失败的两个 .dylib 用空占位文件补上，
   使目录完整。app-builder 下次 unpack 命中该目录即跳过解压。

5. **签名**：`electron-builder.yml` 里 `signtoolOptions.sign: ./sign-noop.cjs` 跳过签名。
   注意 winCodeSign 下载与签名**无关**——rcedit（给 exe 写图标/版本）也用它，所以即使不签名也会触发下载。

---

## 6. 改动文件清单

**新增**
- `packages/common/src/utils/prisma/nodeSqliteAdapter.js` —— 自写 node:sqlite driver adapter
- `packages/common/prisma.config.ts` —— Prisma 7 CLI 配置（schema/migrations/datasource url）
- `packages/common/build.mjs` —— esbuild 构建（替代 rollup）

**重写**
- `packages/common/src/prisma/schema.prisma` —— `prisma-client` generator，删 url/engineType/binaryTargets
- `packages/common/src/utils/prisma/index.js`（getPrisma）—— 用 adapter，删所有 engine 路径
- `packages/common/src/utils/prisma/runPrismaCommand.js` —— 迁移改直接执行 SQL
- `packages/common/src/utils/prisma/dbConstants.js` —— 删 engine 路径逻辑
- `packages/common/src/types.d.ts` —— re-export client/model 类型，删 engine getter
- `packages/common/src/facade.js` —— re-export PrismaClient/Prisma
- `apps/desktop/src/main/utils/db.ts` —— 迁移逻辑简化，类型改从 @app/common 拿
- `apps/desktop/src/main/utils/dbContext.ts` —— 只留 getDBPath/getMigrationsDir
- `apps/desktop/electron-builder.yml` —— 删引擎 extraResources 与排除项，保留 migrations
- 3 个 renderer 文件（App.vue / hooks/useDB.ts / utils/index.ts）—— 导入从 `db_client` 改为 `@app/common`

**依赖/配置**
- `pnpm-workspace.yaml` catalog：prisma/@prisma/client → 7.8.0，删 @prisma/engines，加 @prisma/driver-adapter-utils
- `packages/common/package.json`：`prisma` 移到 devDependencies，删 rollup 相关与 db_client link，加 esbuild
- `apps/desktop/package.json`：删 `db_client` file link
- 删除 `packages/common/rollup.config.mjs`

---

## 7. 验证方法

在真实 Electron 43（Node 24）主进程里跑探针，验证打包后的 `@app/common/dist`：
node:sqlite 可用、迁移建库、CREATE、findMany、关系+DateTime、include join、唯一约束→P2002。
全部通过。最终产物：`apps/desktop/dist/myApp Setup 1.0.0.exe`（~123MB）。

**日常命令**（Prisma 7 下）：
- `prisma generate` / `prisma migrate dev`（靠 prisma.config.ts，无需 `--schema`/dotenv）
- `pnpm --filter @app/common run build`（esbuild 打 dist）
- `pnpm --filter @app/desktop run build`（electron-vite build 出 out/）
- 打包：`electron-builder --win --config.electronDist=<本地 electron dist>` + 镜像环境变量

---

## 8. 回退方案

若 node:sqlite 出问题（它仍是 experimental）：回退到官方 `@prisma/adapter-better-sqlite3`，
adapter 上层代码几乎不变（只换 factory + 加原生 rebuild/asarUnpack），因为本方案的转换逻辑
就是从官方 adapter 移植的。

---

## 9. 官方 7.8.0 对照与已知偏差

`nodeSqliteAdapter.js` 声称逐行移植官方 `@prisma/adapter-better-sqlite3` v7.8.0。
已把官方源码下载到 `docs/prisma7-adapter-ref/`（Apache-2.0，只读留档，来源见该目录 README），
并对 `conversion.ts` / `errors.ts` / `better-sqlite3.ts` / `driver-adapter-utils` 接口逐行对照。

### 9.1 移植保真度：高

转换逻辑几乎逐字一致：`mapDeclType` / `getColumnTypes` / `inferColumnType` / `mapRow` /
`mapArg` / `ColumnTypeEnum` 数值、事务/savepoint/mutex 结构全部对得上。合理且正确的差异：

| 官方（better-sqlite3） | 本仓库（node:sqlite） | 评价 |
|---|---|---|
| `stmt.reader` 判断是否返回行 | `stmt.columns().length===0` + try/catch | 语义等价替代 |
| `db.defaultSafeIntegers(true)`（连接级） | `stmt.setReadBigInts(true)`（语句级） | 正确对应 |
| `error.code` 字符串码 | `error.errcode` 整数码 + 字符串回退 | 正确且更稳 |
| `inferObjectType` 只认 `ArrayBuffer` | **加认 `Uint8Array`** | 比官方更对（见下） |

两处本仓库优于官方 7.8.0，**保留、勿改**：
- **读 BLOB**：node:sqlite 的 BLOB 是 `Uint8Array`，官方只处理 `ArrayBuffer`；本仓库补的
  `Uint8Array` 分支是必须的（`nodeSqliteAdapter.js:135`、`171`）。
- **startTransaction mutex**：官方 `BEGIN` 抛错时 `release` 不会被调用（7.8.0 有 mutex 泄漏），
  本仓库在 catch 里先 `unlock()` 再 `onError()`（`:480-482`），反而修对了。

### 9.2 对照暴露的已知偏差（待修，暂存）

按你的计划：**先全量跑通，再一次性改**。此处仅记录，不在未验证基线上叠改动。

- **偏差 H1（高）— `mapArg` bytes 写路径没跟着读路径对齐**
  官方 bytes 分支返回 `Buffer.from(arg,'base64')`（`nodeSqliteAdapter.js:210-212` 原样照搬）。
  但 node:sqlite 的 `DatabaseSync` 绑定 BLOB 参数期望 `Uint8Array`/`ArrayBuffer`，对纯 `Buffer`
  的接受度跨 Node 版本不一致。**读路径已处理 `Uint8Array`，写路径没改**——读改了、写没改的不对称。
  仅当 schema 有 `Bytes` 字段才触发，故打包验证未暴露。修法：bytes 分支返回 `Uint8Array`。
  验证：加 BLOB round-trip 测试。

- **偏差 M2（中）— checksum 算了不校验（drift 静默）**
  `runPrismaCommand.js` 写入 `_prisma_migrations.checksum`，但读取时只 `SELECT migration_name`
  （`:88-91`），从不比对。migration.sql 内容被改后因目录名已在 applied 集合里直接跳过，DB 与
  schema 悄悄不一致且无告警。修法：读取时比对 checksum，不符则报错中止。

- **偏差 M3（中）— 迁移器 `PRAGMA foreign_keys=ON` 死代码**
  FK pragma 是每连接的；`runPrismaCommand.js:118` 在专用连接上 ON 后 `finally` 立刻 close，
  无意义（运行时 adapter 另开连接自己设 ON）。无害，但说明该分支未被仔细验证。

### 9.3 并发 / 时序隐患（待修，暂存）

- **C1（高）— 启动期迁移 vs IPC 查询的双连接 race**
  `apps/desktop/src/main/index.ts` 在同一同步 tick 内：`initDB()`（fire-and-forget 未 await）、
  `ipcMain.handle(...)`（IPC 立即就绪）、`createMainWindow()`（渲染进程立即启动）。
  `initDB` 需迁移时会 `$disconnect()`（`db.ts:72`）→ 迁移器开第二个 `DatabaseSync` 跑
  `BEGIN…CREATE TABLE…COMMIT` → `$connect()`（`db.ts:82`）。而 `App.vue` 窗口起来 1s 后即发查询，
  `handlePersistenceAction`（`db.ts:29-45`）**不检查 `global.isDBReady`**。若查询落进
  disconnect→connect 窗口，Prisma 会 lazily 重开 adapter 连接，与迁移器连接构成真实双连接 + 写冲突。
  修法：`initDB()` 改 await；DB ready 前 IPC handler 排队或拒绝。

- **C2（高）— 无 `busy_timeout`、无 WAL**
  全仓库 PRAGMA 只有 3 处 `foreign_keys`。默认 rollback-journal + 零 busy timeout，
  意味着 C1 的冲突立刻 `SQLITE_BUSY` 失败（映射成 `SocketTimeout`）而非等锁重试。
  修法：adapter（`nodeSqliteAdapter.js:501` 附近）和迁移器（`runPrismaCommand.js:85` 附近）两处连接
  都加 `PRAGMA busy_timeout=5000` + `PRAGMA journal_mode=WAL`。

- **C3（中）— `AccountModel.updateArrayProp` 非事务 read-modify-write**
  `AccountModel.js:38-50` 是 `await get()` 后 `await update()` 两个独立 await，未包事务；
  `createNewThread` / `saveThreadMessage` 都调它。两个并发 IPC 打同一 account 会丢更新。
  adapter 的 `Mutex` 只在 `startTransaction`（`:476`）加锁，裸 `queryRaw`/`executeRaw` 不加锁。
  修法：用 `prisma.$transaction` 包 read-modify-write。

### 9.4 测试缺口与重建计划

现状：**零测试框架**（root `package.json` 是占位 echo；无 vitest/jest/node:test；
`apps/desktop` 已装 `fast-check@^4.5.3` + `pure-rand` 但未接线）。官方 adapter 测试跑在 Prisma
仓库级共享 functional-test 套件里，不随包分发、无法脱离其 harness 独立跑，故不能直接复用。

重建计划（照 `docs/prisma7-adapter-ref/conversion.ts` 各分支）：
- `mapArg`：int/float/decimal/bigint/boolean/datetime（两种 timestampFormat）/bytes 每分支
- `mapRow`：整数截断、DateTime 数字→ISO、bigint 安全范围边界、BLOB 透传
- `mapDriverError`：UNIQUE/PRIMARYKEY/NOTNULL/FK/BUSY 的 errcode→kind 映射（与官方差异最大，最该测）
- 迁移器：建库→CRUD→唯一约束→迁移幂等→（修 M2 后）checksum drift 检测
- 并发：用 `fast-check` 对「多并发 IPC → updateArrayProp」做属性测试，复现 C3 丢更新

### 9.5 待办处理结果（2026-07-16，全量跑通后一次性处理，已完成）

| 项 | 结论 | 位置 |
|---|---|---|
| H1 bytes 写路径改 `Uint8Array` | **撤销——非 bug**。实测 `Buffer.from(base64)` 是 `Uint8Array` 子类，node:sqlite 直接接受，round-trip 一致；改 `ArrayBuffer` 反而抛错。当前代码保持不变。 | `nodeSqliteAdapter.js` mapArg |
| C1 `initDB` await + IPC ready 门禁 | ✅ 已修：`db.ts` 加 `dbReady` promise，`handlePersistenceAction` 派发前 `await dbReady`；在 `initDB` 的 `finally` resolve（迁移失败也开闸，错误以正常查询错误冒泡而非 hang）。窗口仍立即创建，早期查询排队。 | `db.ts` |
| C2 busy_timeout + WAL（两处连接） | ✅ 已修：adapter `createDatabase` 与迁移器连接均加 `PRAGMA busy_timeout=5000` + `journal_mode=WAL`。 | `nodeSqliteAdapter.js` / `runPrismaCommand.js` |
| C3 `updateArrayProp` 包事务 | ✅ 已修：read-modify-write 改用 `prisma.$transaction` 交互式回调，读写都对 `tx` 发；返回形状统一为 `{account, error}`。 | `AccountModel.js` |
| M2 迁移器校验 checksum | ✅ 已修：已应用迁移的 `migration.sql` 被改动时 checksum 不符即抛错中止（drift guard），不再静默跳过。 | `runPrismaCommand.js` |
| M3 删迁移器死代码 `foreign_keys=ON` | ✅ 已修：删除迁移末尾无意义的 `PRAGMA foreign_keys=ON`（连接随即关闭）。 | `runPrismaCommand.js` |
| 建最小测试套件（node:test + fast-check） | ✅ 已建：`packages/common/test/` 四个文件（conversion / errorMapping / migrationRunner / concurrency），`pnpm --filter @app/common test`，33/33 通过。`fast-check` 提为 common 显式 devDependency。 | `packages/common/test/` |

**验证**：`pnpm --filter @app/common test` 33/33 通过；`pnpm build:pkgs` + desktop typecheck 均通过。

---

## 10. 这是不是"新版 Electron + Prisma"的隐藏红利

算是，但要说清红利的来源：**它不是 Prisma 给的，是新版 Electron/Node 给的，Prisma 7 只是恰好"让开了路"。**

拆成两半看：

- **Prisma 7 的贡献是"减法"**：删掉 Rust query engine、强制走 driver adapter，等于把原来那个必须随包分发、必须在 asar 外定位的引擎二进制（`.dll.node`/`schema-engine.exe`）这个包袱卸了。这不是它送红利，是它**不再挡路**。
- **真正的红利来自 Electron 内置的 `node:sqlite`**：有了一个零编译、零 ABI、随运行时自带的 SQLite，才能填上 Prisma 7 让出的那个 adapter 空位，而不必引入 better-sqlite3 这类原生模块。
  门槛不是某个特定 Electron 大版本，而是**打包所用 Electron 内置的 Node ≥ 22.5**（`node:sqlite` 首次可用的版本）。凡满足此条件的 Electron 都行——实测 Electron 37.10.3（Node 22）即可，本仓库用的 43 也可；37.10.3 不一定是最早能用的版本，具体下限取决于各 Electron 版本捆绑的 Node。

所以准确说法是：**"Prisma 卸掉原生引擎"和"Electron 捆绑的 Node 内置了原生 SQLite"这两个独立趋势在同一时间窗口交汇，催生的一个组合红利**——任何一边早一点都吃不到（Prisma 6 还绑着引擎，Node 22.5 之前也没有 `node:sqlite`）。

**代价（诚实标注，避免误读为白捡）**：官方推荐路径仍是 `@prisma/adapter-better-sqlite3`；本方案走的 `node:sqlite` 仍是 experimental，且 adapter + 迁移器都需自行维护（这正是第 9 节补对照、第 9.3/9.4 修并发与建测试的原因）。本质是**"愿意自扛一点集成责任，换取打包侧的巨大简化"**——红利真实，但非白得。
