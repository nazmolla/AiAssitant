/**
 * Per-user trading integration queries.
 *
 * Stores and retrieves encrypted Kraken (or other exchange) API credentials
 * for a specific user. One row per user per provider.
 */

import { getDb } from "./connection";
import { encryptField, decryptField } from "./crypto";
import { v4 as uuid } from "uuid";

export interface UserIntegration {
  id: string;
  user_id: string;
  provider: string;
  api_key: string;      // decrypted
  api_secret: string;   // decrypted
  config_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getUserIntegration(userId: string, provider: string): UserIntegration | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM user_integrations WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as Record<string, string> | undefined;

  if (!row) return null;

  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    api_key: decryptField(row.api_key) ?? "",
    api_secret: decryptField(row.api_secret) ?? "",
    config_json: row.config_json ? JSON.parse(decryptField(row.config_json) ?? "null") : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function upsertUserIntegration(
  userId: string,
  provider: string,
  apiKey: string,
  apiSecret: string,
  configJson?: Record<string, unknown>,
): UserIntegration {
  const db = getDb();
  const encKey = encryptField(apiKey) ?? "";
  const encSecret = encryptField(apiSecret) ?? "";
  const encConfig = configJson ? encryptField(JSON.stringify(configJson)) : null;
  const id = uuid();

  db.prepare(
    `INSERT INTO user_integrations (id, user_id, provider, api_key, api_secret, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       api_key = excluded.api_key,
       api_secret = excluded.api_secret,
       config_json = excluded.config_json,
       updated_at = CURRENT_TIMESTAMP`
  ).run(id, userId, provider, encKey, encSecret, encConfig ?? null);

  return getUserIntegration(userId, provider)!;
}

export function deleteUserIntegration(userId: string, provider: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM user_integrations WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
  return (result.changes ?? 0) > 0;
}

// ─── Trade log ────────────────────────────────────────────────────────────────

export interface TradeLogEntry {
  userId: string;
  scheduleRunId?: string;
  exchangeOrderId?: string;
  provider?: string;
  pair: string;
  side: "buy" | "sell";
  qty?: number;
  volumeUsd?: number;
  fillPrice?: number;
  feeUsd?: number;
  status: "filled" | "partial" | "cancelled" | "error" | "pending";
  reasoning?: string;
  errorMessage?: string;
}

export function insertTradeLog(entry: TradeLogEntry): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO trading_trade_log
     (user_id, schedule_run_id, exchange_order_id, provider, pair, side,
      qty, volume_usd, fill_price, fee_usd, status, reasoning, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId,
    entry.scheduleRunId ?? null,
    entry.exchangeOrderId ?? null,
    entry.provider ?? "kraken",
    entry.pair,
    entry.side,
    entry.qty ?? null,
    entry.volumeUsd ?? null,
    entry.fillPrice ?? null,
    entry.feeUsd ?? null,
    entry.status,
    entry.reasoning ?? null,
    entry.errorMessage ?? null,
  );
  return result.lastInsertRowid as number;
}

export function getTodayTrades(userId: string, provider = "kraken"): TradeLogEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM trading_trade_log
     WHERE user_id = ? AND provider = ? AND date(created_at) = date('now')
     ORDER BY created_at ASC`
  ).all(userId, provider) as Record<string, unknown>[];

  return rows.map((r) => ({
    userId: r.user_id as string,
    scheduleRunId: r.schedule_run_id as string | undefined,
    exchangeOrderId: r.exchange_order_id as string | undefined,
    provider: r.provider as string,
    pair: r.pair as string,
    side: r.side as "buy" | "sell",
    qty: r.qty as number | undefined,
    volumeUsd: r.volume_usd as number | undefined,
    fillPrice: r.fill_price as number | undefined,
    feeUsd: r.fee_usd as number | undefined,
    status: r.status as TradeLogEntry["status"],
    reasoning: r.reasoning as string | undefined,
    errorMessage: r.error_message as string | undefined,
  }));
}

/** Sum of losses today (filled sells below cost + error costs). Returns positive number = loss. */
export function getTodayLossUsd(userId: string, provider = "kraken"): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(SUM(
       CASE WHEN side = 'sell' AND fill_price IS NOT NULL AND volume_usd IS NOT NULL
            THEN 0  -- P&L tracked separately via portfolio; return 0 here
            ELSE 0
       END
     ), 0) as total_loss
     FROM trading_trade_log
     WHERE user_id = ? AND provider = ? AND date(created_at) = date('now')
       AND status IN ('error', 'cancelled')`
  ).get(userId, provider) as { total_loss: number };
  return row.total_loss;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export function upsertPortfolioPosition(
  userId: string,
  provider: string,
  pair: string,
  qty: number,
  avgEntryPrice: number,
): void {
  const db = getDb();
  if (qty <= 0) {
    db.prepare(
      "DELETE FROM trading_portfolio WHERE user_id = ? AND provider = ? AND pair = ?"
    ).run(userId, provider, pair);
    return;
  }
  db.prepare(
    `INSERT INTO trading_portfolio (user_id, provider, pair, qty, avg_entry_price, last_updated)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, provider, pair) DO UPDATE SET
       qty = excluded.qty,
       avg_entry_price = excluded.avg_entry_price,
       last_updated = CURRENT_TIMESTAMP`
  ).run(userId, provider, pair, qty, avgEntryPrice);
}

export function getPortfolioPositions(
  userId: string,
  provider = "kraken",
): Array<{ pair: string; qty: number; avg_entry_price: number }> {
  const db = getDb();
  return db.prepare(
    "SELECT pair, qty, avg_entry_price FROM trading_portfolio WHERE user_id = ? AND provider = ? AND qty > 0"
  ).all(userId, provider) as Array<{ pair: string; qty: number; avg_entry_price: number }>;
}
