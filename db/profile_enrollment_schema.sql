BEGIN;

ALTER TABLE monitoring_profile
  ADD COLUMN IF NOT EXISTS planned_semester_start_month DATE,
  ADD COLUMN IF NOT EXISTS expected_arrival_date DATE,
  ADD COLUMN IF NOT EXISTS employment_authorization_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS documentation_status TEXT NOT NULL DEFAULT 'UNKNOWN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='monitoring_profile_semester_month_ck' AND conrelid='monitoring_profile'::regclass) THEN
    ALTER TABLE monitoring_profile ADD CONSTRAINT monitoring_profile_semester_month_ck
      CHECK (planned_semester_start_month IS NULL OR planned_semester_start_month=date_trunc('month',planned_semester_start_month)::date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='monitoring_profile_authorization_ck' AND conrelid='monitoring_profile'::regclass) THEN
    ALTER TABLE monitoring_profile ADD CONSTRAINT monitoring_profile_authorization_ck
      CHECK (employment_authorization_status IN ('UNKNOWN','NOT_REQUIRED','PENDING','CONFIRMED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='monitoring_profile_documentation_ck' AND conrelid='monitoring_profile'::regclass) THEN
    ALTER TABLE monitoring_profile ADD CONSTRAINT monitoring_profile_documentation_ck
      CHECK (documentation_status IN ('UNKNOWN','INCOMPLETE','READY'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitoring_profile_history (
  profile_history_id BIGSERIAL PRIMARY KEY,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT NOT NULL DEFAULT 'PROFILE_CLI',
  change_reason TEXT NOT NULL,
  previous_profile JSONB NOT NULL,
  new_profile JSONB NOT NULL,
  CHECK (previous_profile IS DISTINCT FROM new_profile)
);

CREATE INDEX IF NOT EXISTS monitoring_profile_history_changed_idx
  ON monitoring_profile_history(changed_at DESC);

COMMIT;
