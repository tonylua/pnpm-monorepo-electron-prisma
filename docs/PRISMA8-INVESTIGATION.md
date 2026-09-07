# Prisma 8 (RC) 调研与升级尝试 — 记录与结论

**状态：调研完成，升级未合并。**

本会话尝试将本仓库从 Prisma 7.8.0 升级到 Prisma 8（RC）。
调研结论：**当前 v8 公开的 RC 包不是 Prisma 7 的兼容升级，而是 Prisma Composer CLI（统一平台 CLI）的预发布。** 因此升级工作暂停。
本文记录：调研步骤、已尝试的改动、遇到的具体错误、判断依据、以及后续何时/如何重试。

---

## 1. 仓库基线

| 项 | 值 |
|---|---|
| Prisma CLI | 7.8.0（catalog） |
| `@prisma/client` | 7.8.0 |
| `@prisma/driver-adapter-utils` | 7.8.0 |
| `@prisma/config` | 7.8.0 |
| 数据库 | SQLite（通过自维护的 `node:sqlite` driver adapter，零原生依赖） |
| 工作流 | `prisma migrate dev --name init` + `prisma generate` |

完整架构背景见根目录 `PRISMA7-MIGRATION.md`。

---

## 2. v8 RC 版本族（npm 上的实际情况）

`prisma migrate dev`、`prisma generate` 等 v7 命令在 v8 中**已不存在**。这是理解整个调研的关键前提。

通过 `pnpm view <pkg> dist-tags` 实测：

| 包 | `latest` dist-tag | `dev` dist-tag | 是否有 `8.0.0-rc.x`？ |
|---|---|---|---|
| `prisma` (CLI) | `8.0.0-rc.12` | `8.1.0-dev.2` | ✅ 有 rc.3–rc.12 |
| `@prisma/client` | `7.10.0` | `8.1.0-dev.4` | ❌ 跳过 rc.x |
| `@prisma/driver-adapter-utils` | `7.10.0` | `8.1.0-dev.6` | ❌ 跳过 rc.x |
| `@prisma/config` | `7.10.0` | `8.1.0-dev.6` | ❌ 跳过 rc.x |

观察：
- **CLI** 走 `8.0.0-rc.x` → `8.1.0-dev.x` 路线
- **运行时 SDK**（`@prisma/client` 等）走 `7.10.0` → `8.1.0-dev.x` 路线，**跳过了 8.0.0-rc 整个系列**
- CLI 与 SDK 之间存在 `8.0.0-rc.x ↔ 7.10.x` 的横跨 major 错位

> 用户原本要求升级到 `v8.0.0-rc.8`。但实测 `@prisma/client@8.0.0-rc.8`、`@prisma/driver-adapter-utils@8.0.0-rc.8`、`@prisma/config@8.0.0-rc.8` 在 npm 上**不存在**（404）。唯一能让四个包同时存在的版本组合是 `prisma@8.0.0-rc.12` + `@prisma/client@8.1.0-dev.4` + `@prisma/driver-adapter-utils@8.1.0-dev.6` + `@prisma/config@8.1.0-dev.6`。即使组合存在，跨主版本运行时匹配仍是潜在风险。

---

## 3. 真正的破坏点：v8 CLI 是 Composer CLI，不是 Prisma 7 CLI 的继任

`prisma` CLI 在 v8 RC 中已经**完全重构**，是一个统一平台 CLI（prisma deploy / prisma dev / prisma contract / prisma db）。命令实测如下：

### `prisma --help` 输出（v8.0.0-rc.12）
```
auth                Manage local authentication for the CLI
project             Manage and inspect your Prisma projects
postgres            Manage Prisma Postgres databases for a project
bucket              Manage object-store buckets for a project
branch              View your Platform branches
git                 Manage Git repository connections for a project
service             Manage services and their versions for a project
deploy <entry>      Deploy the application whose root is <entry>
dev <entry>         Bring up the application ... entirely on this machine
contract            Define and emit your application data contract
db                  Verify, sign and update your database against the contract
orm                 Initialize a Prisma ORM project
lsp                 Start the Prisma Next language server
migration           Plan, inspect and scaffold on-disk migrations
init                Prepare this repository for Prisma development
## 5. 试跑升级时遇到的具体错误（按时间顺序）

### 5.1 Catalog 写入 + pnpm install
```
@prisma/client@8.1.0-dev.4
@prisma/driver-adapter-utils@8.1.0-dev.6
@prisma/config@8.1.0-dev.6
prisma@8.0.0-rc.12
```
安装成功（约 1270 个包），postinstall 自动触发 `pnpm init:db` 失败：

### 5.2 `prisma migrate dev --name init` 未知命令
```json
{"error":{"code":"CLI.UNKNOWN_COMMAND","summary":"No command registered for `migrate`, did you mean `migration`?"}}
```

### 5.3 `prisma.config.ts` 不被 CLI 接受
升级前项目内的 `prisma.config.ts` 来自 v7：

```ts
import { defineConfig } from 'prisma/config'  // ← v7 的导入
export default defineConfig({ schema, migrations, datasource })
```

CLI 报错 `(0, _config.defineConfig) is not a function`。原因是 v8 RC 的 CLI 用 `@prisma/cli-engine@0.3.0` 替代了旧的 `prisma/config` 入口。把导入改成 `@prisma/config` 后又报：

```json
{"error":{"code":"CLI.CONFIG_MISSING_MARKER","summary":"... default export has no marker — it is most likely a Prisma 7 config"}}
```

按提示换成 `@prisma/cli-engine` 的 `definePrismaConfig` 后，CLI 接受该文件，但所有 v7 风格的 top-level keys 全部不识别：

```json
{"error":{"code":"CLI.CONFIG_UNKNOWN_SECTION","summary":"... top-level key 'schema', which is not a config section this CLI recognises.","why":"The sections this CLI recognises are: composer, orm, skills."}}
```

> **这是决定性证据**：v8 RC CLI 是为 Composer 平台设计的，**它的 config section 集合是 `{composer, orm, skills}`**。传统 Prisma ORM 的 `schema`/`migrations`/`datasource` 全部不在此列。也就是说：用 v8 RC 的 CLI 配合本仓库的 v7 风格 `prisma.config.ts`，根本走不通。

---

## 6. 试跑升级时尝试改动的文件

为方便复盘，下面列出**已尝试但最终被 `git checkout` 还原**的所有改动。

1. **`pnpm-workspace.yaml`** — catalog 的 `prisma` / `@prisma/client` / `@prisma/driver-adapter-utils` 三个键值从 `7.8.0` 改为 `8.1.0-dev.x` / `8.0.0-rc.12`，并新增 `@prisma/config` 键。
2. **`packages/common/package.json`** — `"@prisma/config": "7.8.0"` 改为 `catalog:@prisma/config`。
3. **`packages/common/prisma.config.ts`** — 尝试 `prisma/config` → `@prisma/config` → `@prisma/cli-engine` 的 `definePrismaConfig` 替换。
4. **`pnpm-lock.yaml`** — `pnpm install` 自动重新生成。

上述四项均**已通过 `git checkout -- <file>` 恢复**。当前工作区干净。

---
skills              Keep this project's Prisma agent skills current
feedback <message>  Send feedback to the Prisma CLI team
telemetry           Inspect and change anonymous CLI telemetry
```

v7 中常用的 `prisma migrate dev` / `prisma generate` / `prisma migrate deploy` / `prisma db push` / `prisma db pull` / `prisma studio` **全部消失**。

替代品映射（基于实测子命令 help）：

| v7 命令 | v8 RC 等价命令 |
|---|---|
| `prisma migrate dev` | `prisma migration plan` + `prisma db migrate` |
| `prisma migrate deploy` | `prisma db update` |
| `prisma generate` | `prisma contract emit` |
| `prisma db push` | `prisma db init` |
| `prisma migrate status` | `prisma migration status` |
| `prisma migrate resolve` | （无直接等价，待查） |

---

## 4. 运行时 SDK 接口（driver-adapter-utils）— **向后兼容**

读 `@prisma/driver-adapter-utils@8.1.0-dev.6/dist/index.d.ts`：
- `SqlDriverAdapterFactory`、`SqlDriverAdapter`、`Transaction` 接口**与 v7 几乎相同**
- `ColumnTypeEnum` 新增 `Set: 14`、`Uuid: 15`、和数组变体（Int32Array=64 等），原有 Int32/Int64/Float/Double/Numeric/Boolean/Text/Date/Time/DateTime/Json/Bytes/Enum/Bytes**保留且值未变**
- `bindAdapter` / `bindMigrationAwareSqlAdapterFactory` / `bindSqlAdapterFactory` 仍存在

→ 仓库自维护的 `nodeSqliteAdapter.js` **大概率不需要改动**即可被 v8 运行时 SDK 接受。验证方式是 `pnpm --filter @app/common test` 应全部通过。

---

## 7. 关键判断与建议

### 7.1 何时再尝试升级
- **等待 v8 stable + 至少一个 patch 发布**。
- 关注 [prisma/prisma GitHub releases](https://github.com/prisma/prisma/releases) 与 [Prisma v8 Roadmap](https://www.prisma.io/docs)（待官方发布迁移指南）。
- 关注 Prisma 7.x stable 通道（`7.10.0` 已是 stable）——这是 Composer CLI 出现前最后一个真正的 ORM 升级路径。

### 7.2 如果一定要现在升级 v8
需要做的工作量估算（基于本文调研，不是承诺）：
- 重写 `packages/common/prisma.config.ts`，按 Composer CLI 的 `{composer, orm, skills}` 三大 section 组织配置（schema/datasource/migrations 都需要换名字 + 换位置）。
- 修改 `packages/common/package.json` 的 scripts：把 `db:migrate` 从 `prisma migrate dev --name init` 换成 `prisma migration plan && prisma db migrate`（或 Composer CLI 的等价命令），把 `db:generate` 从 `prisma generate` 换成 `prisma contract emit`。
- 评估"自维护的迁移 runner（`runPrismaCommand.js` + 自建 `_prisma_migrations` 表）"是否还要保留——v8 的 Composer CLI 似乎原生管理 migration 历史（"sign the database"），这部分可能要整个删掉。
- 重新跑 `pnpm --filter @app/common test` 验证 driver adapter 仍兼容 v8 运行时 SDK（`SqlDriverAdapterFactory` 接口大体兼容，但 `ColumnTypeEnum` 多出 `Uuid`/`Set`/array 系列，可能要补 mapDeclType 分支）。
- 重新跑 `pnpm --filter @app/desktop typecheck` + `pnpm build:pkgs` + 桌面冒烟。
- 升级生成的 client 入口路径可能变化（v8 生成产物结构是否仍像 v7 那样分 `.ts`/`.js`/runtime 多目录，要实测），`packages/common/build.mjs` 的 `external`/`copyDir` 策略可能要调。

**预估**：1–3 天全职工作量，且伴随较高风险（Composer CLI 仍在快速演进，文档不全）。

### 7.3 在 v8 升级落地前，本仓库应该做什么
- **保持当前 7.8.0 版本**。`pnpm install` / `pnpm init:db` / `pnpm dev` / `pnpm build:win` 一切照旧。
- 监控 Prisma 7.x stable 通道（`7.10.0` 已是 stable）——这是 Composer CLI 出现前最后一个真正的 ORM 升级路径。
- 这份调研文档留在仓库 `docs/PRISMA8-INVESTIGATION.md`，方便下次接手者直接读。

---

## 8. 一句话总结

v8 RC 公开的 `prisma` 包是 **Prisma Composer CLI**（统一平台 CLI），不是 Prisma 7.x CLI 的兼容升级。它接受 Composer 风格的 config（`{composer, orm, skills}`），拒绝 Prisma 7 风格的 `schema`/`migrations`/`datasource`。在 Composer CLI 没有明确保留 ORM 工作流的迁移文档前，本仓库**不宜**升级到 v8 RC。