import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@app/common";
import type { IFacade, PrismaMigration } from "@app/common";
import * as commonFacade from "@app/common";
import { dbContext } from "./dbContext";

const { getPrisma, getDBConstants, DBModels, runPrismaCommand } =
  commonFacade as unknown as IFacade;
const { getAccountModel, getThreadModel, getThreadMessageModel } = DBModels;
const { dbPath } = getDBConstants(dbContext);

export const isDev = process.env.NODE_ENV === "development";

process.env.DATABASE_URL = `file:${dbPath}`;
const prisma: PrismaClient = getPrisma(dbContext);

const modelsFactory = {
  Account: getAccountModel,
  Thread: getThreadModel,
  ThreadMessage: getThreadMessageModel,
};

// Prisma 7 is Rust-free: migrations are applied by executing the generated
// migration.sql files directly through node:sqlite (see @app/common
// runPrismaCommand), not by forking the Prisma CLI.
const runPrisma = () => runPrismaCommand({ ctx: dbContext });

function parseMigrationPrefix(migrationName?: string): number {
  if (!migrationName) return 0;
  const m = /^(\d{14})_/.exec(migrationName);
  if (!m?.[1]) return 0;
  return Number(m[1]) || 0;
}

/**
 * 获取磁盘上最新的迁移文件夹名（按字典序排序，最后一个即最新）
 */
function getLatestMigrationFromDisk(): string | null {
  try {
    const migrationsDir = dbContext.getMigrationsDir?.();
    if (!migrationsDir || !fs.existsSync(migrationsDir)) {
      console.warn("[initDB] migrations directory not found:", migrationsDir);
      return null;
    }

    const migrations = fs
      .readdirSync(migrationsDir)
      .filter((name) => {
        const full = path.join(migrationsDir, name);
        return (
          fs.statSync(full).isDirectory() &&
          fs.existsSync(path.join(full, "migration.sql"))
        );
      })
      .sort();

    return migrations.length > 0 ? migrations[migrations.length - 1] : null;
  } catch (e) {
    console.error(
      "[initDB] Failed to read migrations from disk:",
      (e as any)?.message,
    );
    return null;
  }
}

// initDB runs unawaited at startup (see main/index.ts) while the IPC handler and
// renderer go live immediately. On a needs-migration launch there is a window
// where initDB has called prisma.$disconnect() and the migration runner holds
// the SQLite file — a query arriving in that window would race the migration.
// This promise gates every IPC query until initDB settles, so early renderer
// calls queue instead of racing. Resolved in initDB's finally (even on failure)
// so a migration error surfaces as a normal query error rather than a hang.
let resolveDBReady: () => void;
const dbReady = new Promise<void>((resolve) => {
  resolveDBReady = resolve;
});

export async function handlePersistenceAction(
  _,
  model: string,
  action: string,
  ...args: unknown[]
) {
  try {
    await dbReady;
    const modelInstanceGetter = modelsFactory[model];
    if (!modelInstanceGetter)
      throw new Error(`factory function for ${model} not found`);
    const m = modelInstanceGetter(prisma);
    if (!m) throw new Error(`model ${model} not found`);
    return m[action](...args);
  } catch (error) {
    console.error(error);
  }
  return null;
}

export async function initDB() {
  let needsMigration = false;
  const dbExists = fs.existsSync(dbPath);
  if (!dbExists) {
    needsMigration = true;
    fs.closeSync(fs.openSync(dbPath, "w"));
  } else {
    try {
      const latest: PrismaMigration[] =
        await prisma.$queryRaw`select * from _prisma_migrations order by finished_at`;
      const mname = latest[latest.length - 1]?.migration_name;
      const currentTs = parseMigrationPrefix(mname);

      // 从磁盘读取最新迁移文件夹作为 baseline，避免手工常量漂移
      const latestMigrationFromDisk = getLatestMigrationFromDisk();
      const requiredTs = parseMigrationPrefix(
        latestMigrationFromDisk ?? undefined,
      );
      needsMigration = currentTs < requiredTs;
      console.log(
        `db latest migration: ${mname}, required baseline: ${latestMigrationFromDisk}, needsMigration=${needsMigration}`,
      );
    } catch (e) {
      console.error(
        "[db.ts SELECT *]",
        e,
        // @ts-expect-error _engine is private API for debug logging
        prisma?._engine?.datasourceOverrides,
      );
      needsMigration = true;
    }
  }
  if (!needsMigration) {
    console.log("%c Does not need migration", "color: green");
    resolveDBReady();
    return;
  }

  // Release the SQLite connection so the migration runner has exclusive write access.
  await prisma.$disconnect();

  try {
    console.log(
      "%c Needs a migration. Applying migration.sql files directly.",
      "color: red",
    );
    await runPrisma();
    console.log("√ Migration done.");
  } catch (e) {
    console.error("× Migration failed.", e);
    throw e;
  } finally {
    await prisma.$connect();
    // Open the gate only after the adapter connection is back — queued IPC
    // queries now run against a live, migrated DB.
    resolveDBReady();
  }
}
