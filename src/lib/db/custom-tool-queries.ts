import { getDb } from "./connection";
import { stmt } from "./query-helpers";

// ─── Custom Tools (agent-created extensibility) ──────────────

export interface CustomToolRecord {
  name: string;
  description: string;
  input_schema: string;
  implementation: string;
  enabled: number;
  created_at: string;
}

export function listCustomTools(): CustomToolRecord[] {
  return getDb()
    .prepare("SELECT * FROM custom_tools ORDER BY created_at DESC")
    .all() as CustomToolRecord[];
}

export function getCustomTool(name: string): CustomToolRecord | undefined {
  return stmt(
    "SELECT * FROM custom_tools WHERE name = ?"
  ).get(name) as CustomToolRecord | undefined;
}

export function createCustomToolRecord(args: {
  name: string;
  description: string;
  inputSchema: string;
  implementation: string;
}): CustomToolRecord {
  getDb()
    .prepare(
      `INSERT INTO custom_tools (name, description, input_schema, implementation, enabled)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(args.name, args.description, args.inputSchema, args.implementation);
  return getCustomTool(args.name)!;
}

export function updateCustomToolEnabled(name: string, enabled: boolean): void {
  getDb()
    .prepare("UPDATE custom_tools SET enabled = ? WHERE name = ?")
    .run(enabled ? 1 : 0, name);
}

export function updateCustomToolRecord(
  name: string,
  fields: { description: string; inputSchema: string; implementation: string }
): void {
  getDb()
    .prepare(
      "UPDATE custom_tools SET description = ?, input_schema = ?, implementation = ? WHERE name = ?"
    )
    .run(fields.description, fields.inputSchema, fields.implementation, name);
}

export function deleteCustomToolRecord(name: string): void {
  getDb().prepare("DELETE FROM custom_tools WHERE name = ?").run(name);
}
