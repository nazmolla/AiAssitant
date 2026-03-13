import { getDb, cachedStmt as _cachedStmt } from "./connection";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
export function stmt(sql: string) { return _cachedStmt(sql, getDb); }

/** Generic paginated result wrapper */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
