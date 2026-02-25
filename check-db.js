const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(__dirname, "nexus.db");
console.log("DB path:", dbPath);
console.log("DB exists:", fs.existsSync(dbPath));
console.log("WAL exists:", fs.existsSync(dbPath + "-wal"));
console.log("SHM exists:", fs.existsSync(dbPath + "-shm"));

try {
  const db = new Database(dbPath);
  console.log("\nOpened OK");
  try {
    const ic = db.pragma("integrity_check");
    console.log("Integrity:", JSON.stringify(ic));
  } catch (e) {
    console.error("Integrity check failed:", e.message);
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log("Tables:", tables.map(t => t.name).join(", "));
    const count = db.prepare("SELECT COUNT(*) as c FROM users").get();
    console.log("Users:", count.c);
  } catch (e) {
    console.error("Query failed:", e.message);
  }
  db.close();
} catch (e) {
  console.error("Open failed:", e.message);
  console.log("\nRemoving WAL/SHM and retrying...");
  if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
  if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
  try {
    const db2 = new Database(dbPath);
    const ic = db2.pragma("integrity_check");
    console.log("After recovery:", JSON.stringify(ic));
    const count = db2.prepare("SELECT COUNT(*) as c FROM users").get();
    console.log("Users:", count.c);
    db2.close();
    console.log("RECOVERED!");
  } catch (e2) {
    console.error("Still broken:", e2.message);
    console.log("DB must be rebuilt: mv nexus.db nexus.db.corrupt");
  }
}
