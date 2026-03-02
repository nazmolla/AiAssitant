const db = require("better-sqlite3")("nexus.db");
const cols = db.prepare("PRAGMA table_info(users)").all();
console.log("Users columns:", cols.map(c => c.name).join(", "));
const users = db.prepare("SELECT * FROM users").all();
console.log("Users:", JSON.stringify(users, null, 2));
try {
  const permCols = db.prepare("PRAGMA table_info(user_permissions)").all();
  console.log("Perms columns:", permCols.map(c => c.name).join(", "));
  const perms = db.prepare("SELECT * FROM user_permissions").all();
  console.log("Permissions:", JSON.stringify(perms, null, 2));
} catch (e) {
  console.log("No user_permissions table:", e.message);
}
db.close();
