BEGIN;

CREATE TABLE IF NOT EXISTS production_backup_runs (
  backup_run_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED')),
  backup_filename TEXT NOT NULL,
  backup_bytes BIGINT,
  sha256 TEXT,
  archive_list_verified BOOLEAN NOT NULL DEFAULT FALSE,
  restore_verified BOOLEAN NOT NULL DEFAULT FALSE,
  restored_lifecycle_count INTEGER,
  error_class TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS production_backup_runs_completed_idx
  ON production_backup_runs(completed_at DESC) WHERE status='SUCCEEDED';

COMMIT;
