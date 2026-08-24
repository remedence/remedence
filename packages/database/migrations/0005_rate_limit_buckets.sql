CREATE TABLE rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  updated_at INTEGER NOT NULL
);

CREATE INDEX rate_limit_buckets_updated_idx
ON rate_limit_buckets (updated_at, bucket_key);
