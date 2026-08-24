import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

export interface RateLimitConsumption {
  count: number;
  resetAt: number;
}

export type RateLimitResult<T> = T | Promise<T>;

export interface RateLimitStore {
  consume(
    key: string,
    currentTime: number,
    windowMs: number,
  ): RateLimitResult<RateLimitConsumption>;
}

interface BucketRow {
  window_started_at: number;
  request_count: number;
}

export function createRateLimitStore(
  database: RemedenceDatabase,
): RateLimitStore {
  const connection = getDatabaseConnection(database);
  const getBucket = connection.prepare(
    `SELECT window_started_at, request_count
     FROM rate_limit_buckets
     WHERE bucket_key = ?`,
  );
  const replaceBucket = connection.prepare(
    `INSERT INTO rate_limit_buckets (
       bucket_key, window_started_at, request_count, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT (bucket_key) DO UPDATE SET
       window_started_at = excluded.window_started_at,
       request_count = excluded.request_count,
       updated_at = excluded.updated_at`,
  );
  const removeInactive = connection.prepare(
    `DELETE FROM rate_limit_buckets WHERE updated_at < ?`,
  );

  return {
    consume(key, currentTime, windowMs) {
      return runTransaction(database, () => {
        removeInactive.run(currentTime - windowMs * 10);
        const current = getBucket.get(key) as BucketRow | undefined;
        const expired =
          !current || currentTime >= current.window_started_at + windowMs;
        const windowStartedAt = expired
          ? currentTime
          : current.window_started_at;
        const count = expired ? 1 : current.request_count + 1;
        replaceBucket.run(key, windowStartedAt, count, currentTime);
        return { count, resetAt: windowStartedAt + windowMs };
      });
    },
  };
}
