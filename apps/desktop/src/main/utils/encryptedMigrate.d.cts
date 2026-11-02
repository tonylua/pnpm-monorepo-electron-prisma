export type HeaderKind =
  "absent" | "empty" | "plaintext" | "encrypted" | "unknown";

export type DatabaseDigest = {
  digest: string;
  counts: Record<string, number>;
  integrity: string;
  foreignKeys: unknown[];
};

export type MigrateIo = {
  stopAt?: string;
  verifyEncrypted(filePath: string): Promise<void>;
  digestPlain(filePath: string): Promise<DatabaseDigest>;
  digestEncrypted(filePath: string): Promise<DatabaseDigest>;
  copy(source: string, destination: string): Promise<void>;
  replaceFile(from: string, to: string): Promise<void>;
};

export function headerKind(filePath: string): HeaderKind;
export function canCreateEmpty(filePath: string): boolean;
export function databaseDigest(db: {
  prepare(sql: string): {
    get(...args: unknown[]): any;
    all(...args: unknown[]): any[];
  };
}): DatabaseDigest;
export function migrateDatabase(
  filePath: string,
  io: MigrateIo,
): Promise<string>;
