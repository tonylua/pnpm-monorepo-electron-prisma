# Prisma 7.8.0 官方 adapter 参考源码（仅供对照）

这些文件是从 `prisma/prisma` 仓库 `7.8.0` tag 下载的**只读参考**，用于和本仓库自写的
`packages/common/src/utils/prisma/nodeSqliteAdapter.js` 做逐行对照。**不参与构建**，不要 import。

许可：Apache-2.0（Prisma）。仅作为移植正确性的对照留档。

| 本地文件 | 上游路径（github.com/prisma/prisma @ 7.8.0） |
|---|---|
| `conversion.ts`    | `packages/adapter-better-sqlite3/src/conversion.ts` |
| `errors.ts`        | `packages/adapter-better-sqlite3/src/errors.ts` |
| `better-sqlite3.ts`| `packages/adapter-better-sqlite3/src/better-sqlite3.ts` |
| `index.ts`         | `packages/adapter-better-sqlite3/src/index.ts` |
| `dau-types.ts`     | `packages/driver-adapter-utils/src/types.ts` |
| `dau-const.ts`     | `packages/driver-adapter-utils/src/const.ts`（`ColumnTypeEnum` 数值定义） |
| `dau-error.ts`     | `packages/driver-adapter-utils/src/error.ts`（`DriverAdapterError`） |
| `dau-result.ts`    | `packages/driver-adapter-utils/src/result.ts` |
| `dau-binder.ts`    | `packages/driver-adapter-utils/src/binder.ts` |
| `dau-index.ts`     | `packages/driver-adapter-utils/src/index.ts` |

对照结论见 `PRISMA7-MIGRATION.md` 第 9 节。

注：adapter 包内**没有** tests 目录——Prisma 的 adapter 正确性测试跑在仓库级共享
functional-test 套件里（对所有 driver 统一跑），不随包分发、无法脱离其 test-harness 独立运行。
因此官方测试无法直接复用；本仓库的测试需照 `conversion.ts` 各分支自行重建（见第 9 节待办）。
