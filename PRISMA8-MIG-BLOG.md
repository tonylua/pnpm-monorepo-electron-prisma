# TypeScript 全面の拥抱 ！Prisma 8 + Electron 升级实战

> 在上一篇[《升级到 Prisma 7:"Rust 除锈" 带来的意外红利》](https://juejin.cn/post/7663304647513735183)里，我们用 Electron 内置的 `node:sqlite` 换掉了 better-sqlite3，代价是要自己维护一个 500 多行的 driver adapter，外加一个手写的迁移 runner，成功将 Prisma 升级到了 v7 版本。

两个月后 Prisma 8（RC）来了：schema 变成了 TypeScript，**我们自己写的那套东西，官方也内置了**。

## 一、背景

还是那个项目：pnpm monorepo + Electron 43（捆绑 Node 24）+ SQLite，产物是 Windows 安装包，要求零原生依赖。

对于 v7 版本，我们当时的方案是在 `@app/common` 里放一个自己写的 `nodeSqliteAdapter.js`（约 550 行，照着官方 better-sqlite3 adapter 逐行移植），再配一个手写迁移 runner，负责读 `migration.sql`、复刻 `_prisma_migrations` 表、做 checksum 校验。这套东西能跑，也稳定，但每次上游发版都得人工比对一遍有没有接口变化，是个长期的维护负担。

## 二、Prisma 8 改了什么

先给总览：

| 维度 | Prisma 7 | Prisma 8 |
|---|---|---|
| Schema 定义 | `schema.prisma`（自有 DSL） | `contract.ts`（TypeScript） |
| 生成命令 | `prisma generate` | `prisma contract emit` |
| 生成产物 | 一整套 ESM TS client | `contract.json`（运行时）+ `contract.d.ts`（类型） |
| 客户端 | `new PrismaClient({ adapter })` | `sqlite({ contractJson })` → `db.connect()` → `orm(...)` |
| 运行时包 | `@prisma/client` 等 | `@prisma/orm-sqlite`（一站式） |
| 迁移执行 | 自写 runner 或 fork CLI | `createSqliteControlClient().dbUpdate()`，幂等 |

TS 化是贯穿性的：schema 本身成了被 tsc 检查的代码；生成的类型独立成 `contract.d.ts`，和运行时那份 JSON 分开；查询 API 的 where、orderBy 换成带类型的回调；CLI 配置重组成 `orm` section。还有一个容易踩的点：v8 的运行时包在 npm 上是 `@prisma/orm-sqlite`，按 subpath exports 组织。

命令也全换了：`migrate dev` 拆成 `migration plan` + `db migrate`，`migrate deploy` 变 `db update`，`generate` 变 `contract emit`，`db push` 变 `db init`。

## 三、Schema 即代码

v8 里模型定义长这样（节选）：

```ts
// packages/common/src/prisma/contract.ts
import { datetimeColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, field, model, rel } from '@prisma/orm-sqlite/contract-builder';

const Thread = model('Thread', {
  fields: {
    id: field.column(textColumn).id().default('uuid()'),
    accountId: field.column(textColumn),
    updateTime: field.column(datetimeColumn),
    // ...
  },
});

export const contract = defineContract({
  models: {
    Thread: Thread.relations({
      account: rel.belongsTo(Account, { from: 'accountId', to: 'id' })
        .sql({ fk: { onDelete: 'cascade' } }),
    }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.accountId])],
    })),
  },
});
```

最大的体感变化是这份定义直接受 tsc 检查：字段名拼错、关系指向不存在的字段、索引里写错列名，都是编译错误，IDE 补全也全有了，不用等 `prisma validate` 跑一轮。v7 的 `@@index`、`onDelete` 是属性字符串，拼错了没有任何提示；v8 的 `cols.accountId` 是从字段定义推导的字面量类型。

`prisma contract emit` 产出两个文件：`contract.json`（16 KB，运行时加载）和 `contract.d.ts`（约 800 行，类型定义）。运行时只需要这份 JSON，不再 import 一大坨生成的 client 代码。

有个语义变化要适应：default 值的责任回到了应用层。v7 的 `@default(now())` 在 RC 的 npm 包里没有对应物（源码里有 `now()`，还没发出来），所以时间戳和 id 由 model 层显式注入，每个 create 都要手动补 `id: crypto.randomUUID()` 和 `createTime`/`updateTime`。我们的做法是 contract 里写 `.default('uuid()')` 保底、应用层显式注入保险，两层都留，宁可冗余也不依赖隐式行为。

## 四、运行时

v8 的初始化比 `new PrismaClient({ adapter })` 步骤多，分三步：

```javascript
// packages/common/src/utils/prisma/index.js
import contractJson from '../../generated/db_client/contract.json' with { type: 'json' }
import { sqliteTypeMiddleware } from './sqliteTypeMiddleware.js'

// db 是工厂,不是连接
export const db = sqlite({ contractJson, middleware: [sqliteTypeMiddleware] })

export async function getPrisma(ctx) {
  const runtime = await db.connect({ path: dbPath })
  const client = orm({ runtime, context: db.context })[UNBOUND_NAMESPACE_ID]
  // 按 v7 风格挂好 model 实例
}
```

`db` 是工厂，连接要显式 `await db.connect({ path })`，多库和重连场景比较清楚。`[UNBOUND_NAMESPACE_ID]` 是 v8 按命名空间组织 client 的取用方式，单库取这个就行，名字确实不好懂，但就这么用。

类型这边，emit 出的 `contract.d.ts` 导出 `Models`/`Contract`，我们在 `types.d.ts` 里 re-export 给下游，desktop 和 renderer 继续从 `@app/common` import，消费姿势和 v7 完全一致。配套细节：`@prisma/orm-sqlite` 的 subpath exports 要求 tsconfig 把 `moduleResolution` 设为 `bundler`，默认的 `node` 解析认不出这些导出。

middleware 是 v8 的新机制。我们有一批 v5 时代传下来的历史数据，时间戳是以毫秒数字符串（`"1758316233000"`）存进 TEXT 列的，读取时要转成 ISO-8601 才能过 codec。v7 时代这个转换写在 adapter 的 `mapRow` 里，想怎么改怎么改；v8 换官方驱动后这条路没了，好在官方在驱动输出和 codec 解码之间留了一个公开的钩子：

```javascript
// packages/common/src/utils/prisma/sqliteTypeMiddleware.js
export const sqliteTypeMiddleware = {
  familyId: 'sql',
  async onRow(row, plan, ctx) {
    for (const [columnName, value] of Object.entries(row)) {
      row[columnName] = normalizeColumnValue(columnName, value)
    }
  },
}
```

同样的数据转换，从改私有实现变成挂公开接口，这个方向是对的。目前按列名启发式（`Time$`/`At$`）判断时间戳列，是权宜之计，后面应该换成按执行计划的列元数据判断。

## 五、查询 API：这次升级的主要工作量

6→7 的麻烦在打包，7→8 的麻烦全在运行时 API。三个 model 文件的每个方法都要改，核心映射如下：

| v7 | v8 |
|---|---|
| `findFirst({ where })` | `.where(where).first()` |
| `findMany({ where, take, skip })` | `.where(where).limit(n).offset(n).all()` |
| `create({ data: {...} })` | `.create({ ...平铺参数 })`，没有 `data` wrapper |
| `update({ where, data })` | `.where(where).update(data)`，强制先 `.where()` |
| `deleteMany({ where })` | `.where(where).deleteAll()` |
| `count({ where })` | `.where(where).aggregate((agg) => ({ n: agg.count() }))` |
| `orderBy: { createTime: 'desc' }` | `orderBy: (t) => t.createTime.desc()`，对象变回调 |
| `$transaction(async (tx) => ...)` | `db.transaction(async (tx) => tx.orm.Account...)` |
| `createMany([...])` | `createAll([...])` |

orderBy 不只是语法变了：回调参数 `t` 带完整的字段类型，`t.createTym` 这种笔误是编译期错误。v7 的对象形式里字段名和方向值都是字符串，拼错了要到运行时才发现。

不过有个折衷：我们为了不动 renderer，在 model 层放了一个 v7 对象到 v8 回调的转换器，动态 key 访问（`t[key][direction]()`）绕过了这层类型检查。好处是升级范围被 model factory 挡住了，renderer 一行没改；代价是新代码应该直接写回调，别再经这层转换。

关系语义也变了。v7 的 `Account.threads` 可以嵌套写入一并更新；v8 的 `rel.hasMany(Thread, { by: 'accountId' })` 是虚拟关系，数据本来就存在 Thread 行里。原来 model 层"把 threads 数组写回 Account"的方法直接没用了，对关系字段的调用静默跳过；真正需要原子读改写的只剩 JSON 标量列，用 `db.transaction` 包起来。注意事务回调里操作的是 `tx.orm.Account`，比 v7 多一层。

类型上还有个小坑：v8 不再导出 `Prisma` 命名空间，renderer 里 `getDBModelProxy<T extends Prisma.ModelName>` 这类泛型代理，靠 types.d.ts 里手写的 `ModelName` 联合类型兜住。代价是加 model 要手动同步这个联合类型，为了让 renderer 零改动，可以接受。

## 六、官方的 SQLite 驱动就是 node:sqlite

前面都是要写的新代码，从这里开始是能删掉的旧代码。

翻 v8 官方源码（`github.com/prisma/orm`）时最先看到的是 `@prisma/orm-sqlite` 的驱动实现：

```ts
// prisma8/packages/3-targets/7-drivers/sqlite/src/sqlite-driver.ts
import { DatabaseSync } from 'node:sqlite';

function openConnection(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
```

`PRAGMA busy_timeout = 5000`，和我们自己 runner 里写的一模一样。官方 README 说得更直白：The driver is Node's built-in node:sqlite, so there is no native module to compile.

也就是说，我们在 v7 里选的 node:sqlite，v8 变成了官方默认路线，连 busy_timeout 的值都没改。落到仓库里：550 行的 `nodeSqliteAdapter.js` 整个删掉，手写的 WAL、错误码映射都不需要了，每次上游发版人工比对的事也没了。

同样重要的是 v8 提供了编程式迁移 API（`@prisma/orm-sqlite/control`），**打包后的 Electron 在运行时直接调 `dbUpdate`，不用再 fork CLI**。打包后自动迁移这个桌面端的刚需，从此有官方方案。

## 七、迁移：手写 runner 退役

v7 的迁移 runner 是仓库里写得最费心的部分：按文件名排序读 `migration.sql`、复刻 `_prisma_migrations` 表、算 sha256 做 drift 校验、事务包裹、错误回滚，外加 WAL、busy_timeout、IPC ready 门禁一堆并发处理。

v8 换成 ControlClient，核心就这几行：

```javascript
// packages/common/src/utils/prisma/runPrismaCommand.js
const controlClient = createSqliteControlClient()
await controlClient.connect(target)
const result = await controlClient.dbUpdate({
  contract: contractJson,
  mode: 'apply',
  migrationsDir,
})
```

140 行变 80 行，语义也变了：`dbUpdate` 是全量 diff，幂等，不用比对时间戳、不用查 `_prisma_migrations`，直接调用，已同步的库上是快速 no-op。

desktop 主进程的 `initDB()` 跟着瘦身。v7 版本要 `$queryRaw` 查迁移表、解析时间戳、和磁盘比对、判断要不要迁、`$disconnect()` 让路、迁完再 `$connect()`；v8 版本就是：文件不存在就建一个空文件，然后无条件跑一次 `dbUpdate`。断开重连的步骤整个不需要了，ControlClient 是独立连接，用完自己关，ORM runtime 不动。IPC ready 门禁留着，继续挡"启动期迁移 vs 早期查询"的竞态。

磁盘上的迁移目录也换了形态：

```
v7:  migrations/20250330045745_init/migration.sql
v8:  migrations/app/refs/db.json              ← ledger
     migrations/snapshots/<hash>/contract.json ← 快照
```

从手写 SQL 文件变成 contract 快照链，diff 由工具从快照间推导。打包侧把这个 `migrations` 目录照旧 `extraResources` 进去就行。另外一个小变化：`init:db` 要从 v7 的 `db:migrate && db:generate` 反过来，先 generate 再 migrate，因为 `contract emit` 的产物是 `db update` 的输入。

## 八、打包侧：一行没改

6→7 那次打包配置改了不少（extraResources 瘦身、排除规则清理），7→8 在打包侧只改了两处：`build.mjs` 的 external 从 `@prisma/client` 改成 `@prisma/orm-sqlite`，依赖声明里删两个旧包加一个新包。`electron-builder.yml` 一行没动，连注释里那句 "Prisma 7 is Rust-free" 都还留着。

产物约 113 MB，v7 时代约 123 MB。零原生依赖保持不变。

回头看，两次升级的麻烦不在同一个地方：

| | 6 → 7 | 7 → 8 |
|---|---|---|
| 打包/分发 | 大改 | 零改动 |
| 运行时查询 API | 基本没变 | 全面重写 |
| Schema 定义 | 小改 | DSL → TypeScript |
| 自己维护的代码 | 增（adapter + runner） | 减（两个都删了） |

6→7 清掉的是分发面上的原生二进制，7→8 清掉的是 schema DSL 这块 TypeScript 管不到的部分，两次各解决一个问题。

## 九、代价与遗留

目前跑的是 RC，几件事要有预期：

版本是 `prisma@8.0.0-rc.15` + `@prisma/orm-sqlite@8.0.0-rc.11`，final 之后可能还有 breaking change，要预留一次再适配。SQLite 在 v8 仍标记为 "proof of concept"（官方 scorecard 里迁移工作流对 SQLite 基本都是 untested），我们敢上是因为迁移逻辑之前被自己的 v7 runner 验证过，`dbUpdate` 这次也实测符合预期。npm 包滞后于源码，`now()` 就是例子。

仓库内部，v7 时代那 33 个 adapter/迁移器测试要重建，测试对象已经删了，`@prisma/driver-adapter-utils` 也从依赖里移除了，新的测试重点应该是 middleware 和 model 层。middleware 的列名启发式前面说过，是权宜之计。`ModelName` 手写联合类型要随 model 增删手动同步。

## 十、写在最后

上一篇的结论是：Prisma 7 的红利来自"卸掉原生引擎"和"Node 内置 SQLite"两个趋势碰在一起，代价是几百行自己维护的代码。

这次升级补上了后半段：我们自己写的那套东西，v8 官方都内置了。adapter 删了，因为官方驱动就是 node:sqlite；迁移 runner 删了，因为官方给了 `createSqliteControlClient`；adapter 里做的数据兼容，搬到了公开的 middleware 接口上。整个 7→8 的迁移花了一个周末，打包侧一行没改。

至于 TS 化，schema、生成产物、查询 API、CLI 配置全部进了 tsc 的检查范围，对一个 TS 项目来说，少了一块管不到的飞地。两次大版本升级，一次解决了分发问题，一次解决了这个问题，方向都是让最终交付物和维护面变小。

如果说这次经历有什么一般性的结论：官方路线没定、而生态条件已经具备的时候，可以自己先把方案做出来。这样的代码寿命不一定长，我们的只用了两个月，但下一个版本来的时候，你会是升级最省事的那一个。

## 十一、版本清单

prisma 8.0.0-rc.15 · @prisma/orm-sqlite 8.0.0-rc.11 · @prisma/cli-engine 0.3.0 · Electron 43.0.0-beta.3 · esbuild ^0.25.0 · Node 24（bundled） · pnpm 11.x · electron-builder 26.0.11

## 十二、参考

1. 上一篇：[升级到 Prisma 7:"Rust 除锈" 带来的意外红利](https://juejin.cn/post/7663304647513735183)
2. Prisma 官方源码仓库 `github.com/prisma/orm`（Apache-2.0）
3. 本仓库升级存档：`docs/PRISMA8-INVESTIGATION.md`、`docs/PRISMA8-FEASIBILITY-TEST.md`、`docs/PRISMA8-MIGRATION-MANUAL-STEPS.md`
4. [Node.js node:sqlite 文档](https://nodejs.org/api/sqlite.html)
5. [Electron 各版本捆绑的 Node.js 对照](https://releases.electronjs.org/)
