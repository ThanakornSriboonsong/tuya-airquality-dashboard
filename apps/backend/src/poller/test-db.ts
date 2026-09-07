import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "../db/client";

/** In-memory DB with the real migrations applied, for tests that need actual SQL semantics. */
export function createTestDb() {
  const db = createDb(":memory:");
  const migrationsDir = join(__dirname, "../../drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sqlFile = readFileSync(join(migrationsDir, file), "utf-8");
    for (const statement of sqlFile.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.$client.exec(trimmed);
    }
  }
  return db;
}
