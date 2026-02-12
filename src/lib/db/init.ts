import { getDb } from "./connection";
import { SCHEMA_SQL } from "./schema";

export function initializeDatabase(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  console.log("[Nexus DB] Schema initialized successfully.");
}

// Run directly with `tsx src/lib/db/init.ts`
if (require.main === module) {
  initializeDatabase();
  console.log("[Nexus DB] Database ready.");
  process.exit(0);
}
