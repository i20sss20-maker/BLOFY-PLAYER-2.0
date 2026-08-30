CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  activation_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trial','active','expired','blocked')),
  trial_started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  last_app_version TEXT,
  last_platform TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_expires_at ON devices(expires_at);
