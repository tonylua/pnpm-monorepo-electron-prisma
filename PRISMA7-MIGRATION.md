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
- 只做向前 apply，不做 Prisma 官方那种 drift/checksum 一致性校验（对桌面 app 单向 schema 演进够用）
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
