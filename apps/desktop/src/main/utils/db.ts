import fs from "node:fs";
import type { IFacade } from "@app/common";
import * as commonFacade from "@app/common";
import { dbContext } from "./dbContext";

const { getPrisma, getDBConstants, runPrismaCommand } =
  commonFacade as unknown as IFacade;
const { dbPath } = getDBConstants(dbContext);

export const isDev = process.env.NODE_ENV === "development";

process.env.DATABASE_URL = `file:${dbPath}`;

// Prisma 8: getPrisma() is async and returns { Account, Thread, ThreadMessage, client, runtime, db }.
// The models are already wired and ready to use. Three-layer memoization is a preventive
// guard added during the v8 migration: concurrent initDB + IPC handler could otherwise race
// getPrisma() and surface as DRIVER.ALREADY_CONNECTED. The race was identified by inspection,
// not observed in practice:
// 1. Sync cache (_prisma) — instant return on subsequent calls
// 2. In-flight promise gate (_prismaPromise) — races queue on the same promise
// 3. finally() cleanup — _prismaPromise resets after settle, allowing retry on failure
type PrismaRuntime = Awaited<ReturnType<typeof getPrisma>>;
let _prisma: PrismaRuntime | null = null;
let _prismaPromise: Promise<PrismaRuntime> | null = null;
function loadPrismaRuntime(): Promise<PrismaRuntime> {
  if (_prisma) return Promise.resolve(_prisma);
  if (!_prismaPromise) {
    _prismaPromise = getPrisma(dbContext)
      .then((runtime) => {
        _prisma = runtime;
        return runtime;
      })
      .finally(() => {
        _prismaPromise = null;
      });
  }
  return _prismaPromise;
}
const prismaPromise = loadPrismaRuntime();

// Prisma 8 uses ControlClient for runtime migrations: dbUpdate is idempotent and
// auto-detects diffs, eliminating the need for the v7 timestamp-comparison logic
// (parseMigrationPrefix, getLatestMigrationFromDisk, $queryRaw _prisma_migrations).
const runPrisma = () => runPrismaCommand({ ctx: dbContext });

// initDB runs unawaited at startup (see main/index.ts) while the IPC handler and
// renderer go live immediately. On a needs-migration launch there is a window
// where initDB is applying the migration — a query arriving in that window would
// race. This promise gates every IPC query until initDB settles, so early renderer
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
    const prisma = await prismaPromise;
    // v8: models are already instantiated on prisma.Account / .Thread / .ThreadMessage
    const m = prisma[model];
    if (!m) throw new Error(`model ${model} not found`);
    return m[action](...args);
  } catch (error) {
    console.error(error);
  }
  return null;
}

export async function initDB() {
  const dbExists = fs.existsSync(dbPath);
  if (!dbExists) {
    // Fresh DB: touch the file so runPrisma (ControlClient) can connect
    fs.closeSync(fs.openSync(dbPath, "w"));
  }

  try {
    // Prisma 8 ControlClient: dbUpdate is idempotent. It auto-detects diffs between
    // the contract and the DB state, applying only what's needed. No need to query
    // _prisma_migrations or compare timestamps — just call it unconditionally.
    // (In production, on a DB that's already up-to-date, this is a fast no-op.)
    console.log(
      "%c Running v8 dbUpdate (idempotent migration check + apply)...",
      "color: cyan",
    );
    await runPrisma();
    console.log("%c ✓ Migration check complete", "color: green");
  } catch (e) {
    console.error("× Migration failed.", e);
    throw e;
  } finally {
    // Open the gate — queued IPC queries now run against a live, migrated DB.
    // No need to disconnect/reconnect in v8: the ControlClient is a separate
    // connection that closes after dbUpdate; the ORM runtime stays open.
    resolveDBReady();
  }
}
