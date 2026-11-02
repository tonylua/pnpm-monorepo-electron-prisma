import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { app, safeStorage } from "electron";
import { isDev } from "./isDev";
import {
  canCreateEmpty,
  databaseDigest,
  headerKind,
  migrateDatabase,
} from "./encryptedMigrate.cjs";

// The file key is held by Electron's safeStorage (DPAPI on Windows) rather than
// keytar. keytar is a native module, and this repo ships none: Prisma 8 on
// node:sqlite is Rust-free and electron-builder runs with npmRebuild: false.
// safeStorage is built in, so the "zero native dependencies" property holds.
const MAIN_ACCOUNT = "db-file-vfs-main-v1";
const nodeRequire = createRequire(import.meta.url);

type SqliteDatabase = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    get(...args: unknown[]): Record<string, unknown>;
    all(...args: unknown[]): Record<string, unknown>[];
  };
  loadExtension(file: string): void;
  enableLoadExtension(enabled: boolean): void;
};

type SqliteModule = {
  DatabaseSync: new (
    location: string | URL,
    options?: { allowExtension?: boolean },
  ) => SqliteDatabase;
  backup(source: SqliteDatabase, destination: string): Promise<number>;
};

let bootstrap: SqliteDatabase | null = null;
let vfsReady: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();
const registered = new Set<string>();

function sqliteModule(): SqliteModule {
  return nodeRequire("node:sqlite") as SqliteModule;
}

function encryptedVfsDll(): string {
  const base = isDev
    ? path.join(
        app.getAppPath().replace("app.asar", "app.asar.unpacked"),
        "resources",
      )
    : process.resourcesPath;
  return path.join(base, "encrypted_vfs.dll");
}

function keyFile(account: string): string {
  return path.join(app.getPath("userData"), `${account}.key`);
}

// A key is minted only when no key exists yet. If a key is missing while an
// EVFS1 file is already on disk, that data is unrecoverable; minting a fresh
// key would turn that into a confusing auth failure, so fail loudly instead.
async function fileKey(account: string, filePath: string): Promise<Buffer> {
  const file = keyFile(account);
  if (fs.existsSync(file)) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(`KEY_UNAVAILABLE:${account}`);
    const key = safeStorage.decryptString(fs.readFileSync(file));
    const bytes = Buffer.from(key, "hex");
    if (bytes.length !== 32) throw new Error(`KEY_INVALID:${account}`);
    return bytes;
  }

  const kind = headerKind(filePath);
  if (kind === "encrypted") throw new Error(`KEY_UNAVAILABLE:${account}`);
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(`KEY_UNAVAILABLE:${account}`);

  const created = crypto.randomBytes(32);
  const hex = created.toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(hex));
  const readBack = safeStorage.decryptString(fs.readFileSync(file));
  if (readBack !== hex) throw new Error(`KEY_UNAVAILABLE:${account}`);
  return created;
}

function registerDatabase(filePath: string, key: Buffer): void {
  if (!bootstrap) throw new Error("VFS_UNAVAILABLE");
  const result = bootstrap
    .prepare("SELECT encrypted_vfs_register_db(?, ?, ?) AS result")
    .get(filePath, key, "open-existing");
  if (result.result !== "ok") throw new Error("VFS_UNAVAILABLE");
}

function win32Uri(filePath: string): URL {
  const uri = pathToFileURL(filePath);
  uri.searchParams.set("vfs", "win32");
  return uri;
}

function openDigest(
  open: () => SqliteDatabase,
): ReturnType<typeof databaseDigest> {
  const db = open();
  try {
    return databaseDigest(db);
  } finally {
    db.close();
  }
}

async function replaceFile(from: string, to: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last;
}

async function migratePlaintext(filePath: string, key: Buffer): Promise<void> {
  const { DatabaseSync, backup } = sqliteModule();
  await migrateDatabase(filePath, {
    async verifyEncrypted(target: string) {
      registerDatabase(target, key);
      const digest = openDigest(() => new DatabaseSync(target));
      if (digest.integrity !== "ok") throw new Error("DATABASE_AUTH_FAILED");
    },
    async digestPlain(target: string) {
      return openDigest(() => new DatabaseSync(win32Uri(target)));
    },
    async digestEncrypted(target: string) {
      registerDatabase(target, key);
      return openDigest(() => new DatabaseSync(target));
    },
    async copy(source: string, destination: string) {
      fs.rmSync(destination, { force: true });
      registerDatabase(destination, key);
      const plain = new DatabaseSync(win32Uri(source));
      try {
        await backup(plain, destination);
      } finally {
        plain.close();
      }
    },
    replaceFile,
  });
}

async function prepareOne(filePath: string, key: Buffer): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const kind = headerKind(filePath);
  if (kind === "unknown") throw new Error("FORMAT_UNSUPPORTED");
  await migratePlaintext(filePath, key);
  const settled = headerKind(filePath);
  if (settled === "unknown" || settled === "plaintext") {
    throw new Error(
      settled === "plaintext"
        ? "DATABASE_RECOVERY_REQUIRED"
        : "FORMAT_UNSUPPORTED",
    );
  }
  registerDatabase(filePath, key);
}

async function loadVfs(): Promise<void> {
  if (bootstrap) return;
  const dll = encryptedVfsDll();
  if (!fs.existsSync(dll)) throw new Error("VFS_UNAVAILABLE");
  const { DatabaseSync } = sqliteModule();
  bootstrap = new DatabaseSync(":memory:", { allowExtension: true });
  bootstrap.loadExtension(dll);
  bootstrap.enableLoadExtension(false);
  const activated = bootstrap
    .prepare("SELECT encrypted_vfs_activate() AS name")
    .get();
  if (activated.name !== "encrypted-vfs") throw new Error("VFS_INCOMPATIBLE");
}

async function preparePath(filePath: string, account: string): Promise<void> {
  if (!vfsReady) {
    vfsReady = loadVfs().catch((error) => {
      vfsReady = null;
      bootstrap = null;
      throw error;
    });
  }
  await vfsReady;
  const marker = path.resolve(filePath);
  if (registered.has(marker)) return;
  const key = await fileKey(account, filePath);
  try {
    await prepareOne(filePath, key);
  } finally {
    key.fill(0);
  }
  registered.add(marker);
}

// Wipes the process-held file keys. Called on before-quit so the key bytes do
// not sit in memory for the lifetime of a lingering process.
export function shutdownEncryptedVfs(): void {
  if (!bootstrap) return;
  try {
    bootstrap.prepare("SELECT encrypted_vfs_shutdown(?)").get("force");
  } finally {
    try {
      bootstrap.close();
    } catch {
      // The process is leaving. The key bytes were wiped before close.
    }
    bootstrap = null;
    vfsReady = null;
    registered.clear();
  }
}

// Serialized: two databases must not race the one bootstrap connection.
export function ensureEncryptedVfs(
  filePath: string,
  account: string,
): Promise<void> {
  const run = queue.then(() => preparePath(filePath, account));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export { canCreateEmpty };
export const ENCRYPTED_VFS_MAIN_ACCOUNT = MAIN_ACCOUNT;
