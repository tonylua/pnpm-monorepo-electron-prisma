import fs from "node:fs";
import { app } from "electron";
import type { IFacade } from "@app/common";
import * as commonFacade from "@app/common";
import { dbContext } from "./dbContext";
import {
  ENCRYPTED_VFS_MAIN_ACCOUNT,
  canCreateEmpty,
  ensureEncryptedVfs,
  shutdownEncryptedVfs,
} from "./encryptedSqlite";

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
// The encrypted VFS must be the default VFS before the first open, so every
// connect goes through ensureEncryptedVfs first. ensureEncryptedVfs is
// idempotent per path and serialized internally.
function loadPrismaRuntime(): Promise<PrismaRuntime> {
  if (_prisma) return Promise.resolve(_prisma);
  if (!_prismaPromise) {
    _prismaPromise = ensureEncryptedVfs(dbPath, ENCRYPTED_VFS_MAIN_ACCOUNT)
      .then(() => getPrisma(dbContext))
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

// Prisma 8 uses ControlClient for runtime migrations: dbUpdate is idempotent and
// auto-detects diffs, eliminating the need for the v7 timestamp-comparison logic
// (parseMigrationPrefix, getLatestMigrationFromDisk, $queryRaw _prisma_migrations).
const runPrisma = () => runPrismaCommand({ ctx: dbContext });

// initDB runs unawaited at startup (see main/index.ts) while the IPC handler and
// renderer go live immediately. On a needs-migration launch there is a window
// where initDB is applying the migration — a query arriving in that window would
// race. This promise gates every IPC query until initDB settles, so early renderer
// calls queue instead of racing.
//
// Unlike before the VFS, this gate is rejected (not resolved) on failure. A
// failed ensureEncryptedVfs means the file key is unavailable or the file is
// not a format we can open; letting queries through at that point would run
// them against the wrong database or create an empty one. Queries now fail.
let resolveDBReady: () => void;
let rejectDBReady: (reason?: unknown) => void;
const dbReady = new Promise<void>((resolve, reject) => {
  resolveDBReady = resolve;
  rejectDBReady = reject;
});
// dbReady is rejected on a failed init. If no IPC query ever awaits it, that
// rejection is unobserved and Node reports it as unhandled. The real error is
// already logged and rethrown by initDB, so swallow it on this branch only.
void dbReady.catch(() => undefined);

export async function handlePersistenceAction(
  _,
  model: string,
  action: string,
  ...args: unknown[]
) {
  try {
    await dbReady;
    const prisma = await loadPrismaRuntime();
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
  try {
    // Load the DLL, resolve the file key, and migrate a plaintext database to
    // EVFS1 if needed — all before anything opens the file.
    await ensureEncryptedVfs(dbPath, ENCRYPTED_VFS_MAIN_ACCOUNT);

    // Fresh DB: touch the file so runPrisma (ControlClient) can connect.
    // canCreateEmpty, not !existsSync: an empty file must not be created on top
    // of a half-finished migration, where the real data is still in the
    // .plaintext-bak or .encrypting sibling and would be shadowed by it.
    if (canCreateEmpty(dbPath)) {
      fs.closeSync(fs.openSync(dbPath, "w"));
    }

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
    // Open the gate — queued IPC queries now run against a live, migrated DB.
    // No need to disconnect/reconnect in v8: the ControlClient is a separate
    // connection that closes after dbUpdate; the ORM runtime stays open.
    resolveDBReady();
  } catch (e) {
    console.error("× Migration failed.", (e as Error)?.message);
    rejectDBReady(e);
    throw e;
  }
}

// Erase the process-held file key on the way out. before-quit is deferred once
// so the synchronous shutdown completes before the process goes away.
let fileKeyWipeStarted = false;
app.on("before-quit", (event) => {
  if (fileKeyWipeStarted) return;
  fileKeyWipeStarted = true;
  event.preventDefault();
  try {
    shutdownEncryptedVfs();
  } catch (error) {
    console.error("[db] encrypted vfs shutdown", error);
  } finally {
    app.quit();
  }
});
