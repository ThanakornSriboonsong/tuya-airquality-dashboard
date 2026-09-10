import Database from "better-sqlite3";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * `mustExist` guards the worst failure mode this project has: DB_PATH pointing
 * somewhere unintended (a relative path resolved against the wrong working
 * directory, say). better-sqlite3's default is to create the file, so the
 * poller would happily write into a brand new empty database while the real one
 * sits untouched — a silent data loss that isn't visible until you go looking.
 * Creating the file is the migration step's job; the app only ever opens one.
 */
export function createDb(dbPath: string, opts: { mustExist?: boolean } = {}) {
  const mustExist = opts.mustExist ?? false;
  let sqlite: Database.Database;
  try {
    sqlite = new Database(dbPath, { fileMustExist: mustExist });
  } catch (err) {
    if (mustExist) {
      // Say which path, resolved: the usual cause is a relative DB_PATH read
      // from an unexpected working directory, and the raw sqlite error
      // ("unable to open database file") doesn't tell you where it looked.
      throw new Error(
        `Cannot open database at ${resolve(dbPath)} (DB_PATH=${dbPath}). ` +
          `Run migrations to create it, or fix DB_PATH — refusing to start ` +
          `rather than write readings into a new empty database.`,
        { cause: err },
      );
    }
    throw err;
  }
  sqlite.pragma("journal_mode = WAL");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
