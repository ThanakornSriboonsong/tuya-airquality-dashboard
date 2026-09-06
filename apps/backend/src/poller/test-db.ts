import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "../db/client";

/** In-memory DB with the real migration applied, for tests that need actual SQL semantics. */
export function createTestDb() {
  const db = createDb(":memory:");
  const sqlFile = readFileSync(
    join(__dirname, "../../drizzle/0000_chilly_king_cobra.sql"),
    "utf-8",
  );
  for (const statement of sqlFile.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.$client.exec(trimmed);
  }
  return db;
}
