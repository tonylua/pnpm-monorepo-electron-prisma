const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function headerKind(filePath) {
  if (!fs.existsSync(filePath)) return "absent";
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return "empty";
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  const text = header.toString("utf8");
  if (text.startsWith("SQLite format 3")) return "plaintext";
  if (text.startsWith("EVFS1")) return "encrypted";
  return "unknown";
}

function migrationPaths(filePath) {
  const directory = path.dirname(filePath);
  const base = path.basename(filePath);
  return {
    filePath,
    encrypting: path.join(directory, `.${base}.encrypting`),
    backup: `${filePath}.plaintext-bak`,
    record: `${filePath}.evfs-migrate.json`,
  };
}

function canCreateEmpty(filePath) {
  const paths = migrationPaths(filePath);
  if (headerKind(filePath) !== "absent") return false;
  if (headerKind(paths.backup) !== "absent") return false;
  if (headerKind(paths.encrypting) !== "absent") return false;
  return true;
}

function writeRecord(filePath, state) {
  const paths = migrationPaths(filePath);
  const body = JSON.stringify({ v: 1, state, file: path.basename(filePath) });
  fs.writeFileSync(paths.record, body);
}

function clearRecord(filePath) {
  fs.rmSync(migrationPaths(filePath).record, { force: true });
}

function stableValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort())
      out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

function databaseDigest(db) {
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const hash = crypto.createHash("sha256");
  const counts = {};
  for (const table of tables) {
    const name = String(table.name).replace(/"/g, '""');
    hash.update(String(table.name));
    hash.update("\0");
    hash.update(table.sql || "");
    hash.update("\0");
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    counts[table.name] = rows.length;
    hash.update(String(rows.length));
    hash.update("\0");
    for (const row of rows) {
      hash.update(JSON.stringify(stableValue(row)));
      hash.update("\n");
    }
  }
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  return {
    digest: hash.digest("hex"),
    counts,
    integrity: integrity.integrity_check,
    foreignKeys,
  };
}

function sameDatabase(left, right) {
  if (left.integrity !== "ok" || right.integrity !== "ok") return false;
  if (JSON.stringify(left.foreignKeys) !== JSON.stringify(right.foreignKeys))
    return false;
  return left.digest === right.digest;
}

// Resume from the files on disk. The plaintext source is never deleted unless an
// encrypted replacement has already passed the caller's verify callback.
async function migrateDatabase(filePath, io) {
  const paths = migrationPaths(filePath);
  const unknown = [
    headerKind(filePath),
    headerKind(paths.backup),
    headerKind(paths.encrypting),
  ].includes("unknown");
  if (unknown) throw new Error("FORMAT_UNSUPPORTED");

  if (headerKind(filePath) === "encrypted") {
    const dirty =
      headerKind(paths.backup) !== "absent" ||
      headerKind(paths.encrypting) !== "absent" ||
      fs.existsSync(paths.record);
    if (dirty) {
      await io.verifyEncrypted(filePath);
      if (headerKind(paths.backup) === "plaintext")
        fs.rmSync(paths.backup, { force: true });
      if (headerKind(paths.encrypting) !== "absent")
        fs.rmSync(paths.encrypting, { force: true });
      clearRecord(filePath);
    }
    return "encrypted";
  }

  if (
    (headerKind(filePath) === "absent" || headerKind(filePath) === "empty") &&
    headerKind(paths.backup) === "plaintext"
  ) {
    if (headerKind(filePath) === "empty") fs.rmSync(filePath, { force: true });
    await io.replaceFile(paths.backup, filePath);
  } else if (headerKind(filePath) === "empty") {
    fs.rmSync(filePath, { force: true });
  }

  if (headerKind(filePath) !== "plaintext") return headerKind(filePath);

  writeRecord(filePath, "SOURCE_VERIFIED");
  if (io.stopAt === "SOURCE_VERIFIED") return "SOURCE_VERIFIED";
  if (headerKind(paths.encrypting) === "encrypted") {
    const source = await io.digestPlain(filePath);
    const target = await io.digestEncrypted(paths.encrypting);
    if (!sameDatabase(source, target))
      fs.rmSync(paths.encrypting, { force: true });
  } else if (headerKind(paths.encrypting) !== "absent") {
    fs.rmSync(paths.encrypting, { force: true });
  }

  writeRecord(filePath, "TARGET_COPYING");
  if (headerKind(paths.encrypting) !== "encrypted") {
    if (io.stopAt === "TARGET_COPYING") return "TARGET_COPYING";
    await io.copy(filePath, paths.encrypting);
  }
  const sourceDigest = await io.digestPlain(filePath);
  const targetDigest = await io.digestEncrypted(paths.encrypting);
  if (!sameDatabase(sourceDigest, targetDigest)) {
    fs.rmSync(paths.encrypting, { force: true });
    throw new Error("DATABASE_RECOVERY_REQUIRED");
  }
  writeRecord(filePath, "TARGET_VERIFIED");
  if (io.stopAt === "TARGET_VERIFIED") return "TARGET_VERIFIED";

  writeRecord(filePath, "SWITCHING");
  if (headerKind(paths.backup) === "absent")
    await io.replaceFile(filePath, paths.backup);
  if (io.stopAt === "SWITCHING") return "SWITCHING";
  if (headerKind(filePath) !== "encrypted") {
    try {
      await io.replaceFile(paths.encrypting, filePath);
    } catch (error) {
      if (
        headerKind(filePath) !== "encrypted" &&
        headerKind(paths.backup) === "plaintext"
      ) {
        if (
          headerKind(filePath) === "absent" ||
          headerKind(filePath) === "empty"
        ) {
          if (headerKind(filePath) === "empty")
            fs.rmSync(filePath, { force: true });
          await io.replaceFile(paths.backup, filePath);
        }
      }
      throw error;
    }
  }
  await io.verifyEncrypted(filePath);
  fs.rmSync(paths.backup, { force: true });
  clearRecord(filePath);
  return "ACTIVE";
}

module.exports = {
  headerKind,
  migrationPaths,
  canCreateEmpty,
  databaseDigest,
  sameDatabase,
  migrateDatabase,
};
